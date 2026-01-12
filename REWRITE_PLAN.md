# mumble-web 技术栈重构方案（Next.js + WebSocket + WASM，弃用 WebRTC）

本文档描述将当前 `mumble-web`（webpack + knockout + WebRTC/WS 语音回退）彻底重构为现代技术栈：`Next.js 16+（App Router） + React 19 + Tailwind CSS + shadcn/ui + WASM + WebSocket`，并**完全弃用 WebRTC**，使用**自托管 WebSocket 网关**对接原生 Mumble 服务器（TCP/TLS + 语音 UDP 或 TCP 隧道）。

---

## 0. 当前进度（已落地到仓库）

- M0 ✅：已引入 `pnpm-workspace.yaml`，新增 `apps/web`（Next.js+Tailwind+shadcn 风格组件）与 `apps/gateway`（WS 网关）骨架；旧版代码仍保留在根目录 `app/`。
- M1 ✅：`gateway` 已实现白名单 serverList、connect/auth、频道/用户快照与增量更新、join channel、TextMessage 收发、ping/metrics（基础）。
- M2 ✅：`web` 已实现连接页与主界面（频道树 / 用户列表 / 聊天 / 加入频道 / RTT 展示），并与 `gateway` 通过 WebSocket 协议联通（M0–M2 阶段不含语音）。
- M3 ✅：已实现下行语音（听得到）：网关透传 Opus 帧（TCP `UDPTunnel`）并以 WS binary 下发；前端用 WebCodecs 解码为 PCM，再交给 `AudioWorklet` 混音播放。
- M4 ✅：已实现上行语音（能说）：前端 `AudioWorklet` 采集 + VAD/PTT gating，将 PCM 交给 WebCodecs 编码为 Opus 后通过 WS binary 上送；网关封包并通过 TCP `UDPTunnel` 发往 Mumble 服务器。

> 说明：当前实现已切换为“浏览器侧 Opus 编/解码（WebCodecs）/ 网关侧仅封包透传”的形态；语音传输目前仅实现 TCP 语音隧道（`UDPTunnel`），UDP/OCB-AES128（更低延迟）可在后续阶段补齐。

## 1. 目标与范围

### 1.1 必达目标（对应需求点）

1. 使用现代 Web Audio API（以 `AudioWorklet` 为核心）处理音频采集、播放与混音，替代旧的音频节点/线程模型。
2. 通过 WebSocket tunneling（自托管 `gateway`）包装/代理 Mumble 连接，浏览器只连网关。
3. 支持 Mumble 协议（控制面 TCP/TLS + 语音 UDP（优先）/TCP（隧道化）），实现频道/用户状态同步、加入频道、聊天等核心功能。
4. 支持 Opus 编码，并支持降噪算法（WASM），同时提供 VAD（语音活动检测）以优化体验。
5. 支持显示 channel 与 user 列表，加入频道等常用交互。
6. 现代化 UI/UX：使用 `shadcn/ui` + Tailwind，提供更符合当代审美和可用性的界面与交互。
7. 提供延迟展示：WS RTT、Mumble 服务器 RTT、播放缓冲等关键指标。

### 1.2 明确约束（已确认）

- 网关仅允许连接**白名单**内的 Mumble 服务器；客户端不可提交任意 host/port。
- 接受**自托管**部署（网关可使用 UDP）。
- 浏览器侧只做：**降噪 + VAD/PTT + Opus 编/解码 + 播放**；Mumble 协议、加密与语音收发（UDP 或 TCP 隧道）全部在网关侧完成。
- 语音传输优先使用 UDP（低延迟）；同时支持 Mumble 协议内建的 TCP 语音隧道（未连接独立 voice channel 时，语音会通过 data stream 传输）作为 fallback/可配置。
- 不做网关鉴权，仅依赖白名单 + 网络隔离（反代/内网/防火墙）。
- 单会话即可（同一时间只维护一个 server/session 连接）。

---

## 2. 总体架构

### 2.1 Monorepo 结构（建议）

- `apps/web/`：Next.js 前端（React 19 + Tailwind + shadcn/ui）
  - 负责：UI/状态渲染、设备权限、音频处理（Worklet）、WASM 编解码与降噪、与网关的 WS 通讯
- `apps/gateway/`：自托管 WebSocket 网关（Node.js + TypeScript）
  - 负责：白名单选择、Mumble TCP/TLS 控制连接、Mumble 语音（UDP 或 TCP 隧道）收发与加解密、状态同步、延迟/丢包统计
- `packages/protocol/`：Web ↔ Gateway 的协议与类型（TS）
- `packages/audio-wasm/`：Opus + RNNoise 的 WASM 封装（加载、worker API、可选 SIMD/线程）

> 旧实现（`app/`、webpack、knockout、WebRTC 相关路径）将先保留用于对照与分阶段迁移，最终在收敛后移除。

### 2.2 数据流与职责边界

- 控制面：
  - `web (WS)` ⇄ `gateway` ⇄ `mumble server (TCP/TLS)`
- 语音面：
  - `web (WS binary frames)` ⇄ `gateway` ⇄ `mumble server (UDP 或 TCP 隧道)`
- 加密/协议：
  - 网关负责所有 Mumble 协议与语音加密细节（含 `CryptSetup`、语音包加解密、nonce/重放窗口等）。
  - 浏览器只处理 Opus 载荷与音频效果（降噪、VAD、增益、重采样、播放缓冲）。

---

## 3. Gateway（WebSocket 网关）设计

### 3.1 白名单服务器配置

- 采用静态配置文件，例如：
  - `apps/gateway/config/servers.json`
  - 每个条目包含：`id`、`name`、`host`、`port`、`tls.verify`（是否校验证书/是否允许自签）、可选默认 `tokens`
- 前端连接时只提交 `serverId`，网关从配置中解析真实目标地址并建立连接。

### 3.2 会话模型（单会话）

- 每个浏览器 WebSocket 连接对应一个 `MumbleSession`：
  - `controlSocket`：到 Mumble 服务器的 TCP/TLS 控制连接
  - `udpSocket`：到 Mumble 服务器的 UDP 语音 socket（可选，低延迟）
  - `voiceTransport`：当前语音承载（`udp` 或 `tcp-tunnel`）
  - `state`：频道树、用户表、自己的 userId/channelId、权限/最大带宽等
  - `metrics`：RTT、丢包/抖动统计、队列水位、编码帧率等

### 3.3 Mumble 协议支持范围（第一阶段“可用集”）

- 必须实现/转发的核心消息（按产品功能优先级）：
  - 连接与状态：`Version`、`Authenticate`、`ServerSync`
  - 频道：`ChannelState`、`ChannelRemove`
  - 用户：`UserState`、`UserRemove`
  - 聊天：`TextMessage`
  - 心跳/延迟：`Ping`
  - 语音加密初始化：`CryptSetup`
- 语音：
  - UDP 收到语音包（优先）或通过 TCP data stream 收到隧道化语音包（`UDPTunnel`）→ 解密/解析 → 得到 Opus 帧 → 下发给浏览器
  - 浏览器上行 Opus 帧 → 网关封包/加密 → 通过 UDP 发送（优先）或通过 TCP 隧道发送（fallback）

> 说明：浏览器不需要理解 Mumble UDP 结构与加密，网关对外只暴露“用户语音帧”语义。

### 3.3.1 语音承载选择（UDP / TCP 隧道）

根据 Mumble 官方网络协议文档抽象，Mumble 连接可视为：

- 必需的 data stream（TCP/TLS）：承载协议控制消息；也可作为语音承载的 fallback。
- 可选的 voice stream（通常为 UDP-like）：用于更低延迟的语音传输；若未建立该通道，语音会通过 data stream 隧道化传输（协议实现中通常对应 `UDPTunnel` 类消息承载 UDP 包载荷）。

本方案中网关策略为：默认使用 UDP（更低延迟、减少 TCP head-of-line blocking 影响），UDP 不可达或按配置要求时切换到 TCP 隧道模式。

### 3.4 可观测性与延迟统计

- `wsRttMs`：web⇄gateway ping/pong
- `serverRttMs`：gateway⇄mumble `Ping` 往返（或等价方式）
- `voiceStats`：丢包率、乱序、抖动估计（UDP 模式下更完整；TCP 隧道模式下以队列/RTT 为主）
- `audioQueueMs`：浏览器端上报的 jitter buffer 深度与播放缓冲

### 3.5 安全与运维（无鉴权前提下的最低要求）

- **强制白名单**（不可旁路）
- 并发限制与资源上限（每连接的内存/队列上限，避免 DoS）
- 日志与错误分类（连接失败、证书错误、鉴权失败、版本不匹配、UDP 不可达/已回退到 TCP 隧道等）

---

## 4. Web ↔ Gateway WebSocket 协议设计

### 4.1 控制消息（建议 JSON）

- `hello`：协议版本、客户端信息
- `serverList`：白名单列表（id/name/提示）
- `connect`：`serverId` + `username/password/tokens` + 可选 `channelPath`
- `connected`：会话信息（selfId、rootChannelId、serverVersion…）
- `stateSnapshot`：初始频道/用户快照
- `channelUpsert/channelRemove`
- `userUpsert/userRemove`
- `joinChannel`：目标 channelId（或 path）
- `textSend/textRecv`
- `metrics`：周期性推送延迟/丢包/队列水位
- `error`：结构化错误（code/message/details）

### 4.2 语音消息（二进制帧）

- 统一使用 WebSocket binary frame 传输 Opus bytes
- 帧头（示意）：
  - `type`（uplink/downlink）
  - `target`（normal/shout/whisper 等）
  - `userId`（下行必需）
  - `timestamp/seq`（用于 jitter buffer 与延迟估计）
  - `payload`：Opus frame bytes

### 4.3 背压与实时性策略

- 控制消息不丢；语音消息在队列堆积时丢弃“过期帧”，保证实时性优先。
- 网关与浏览器都需要设置发送队列上限与丢弃策略，避免内存无限增长。

---

## 5. 浏览器音频方案（AudioWorklet + WASM + VAD）

### 5.1 设计目标

- 低延迟：默认 20ms 帧（48kHz 下 960 samples）
- 可控：降噪/VAD/增益/码率可配置
- 可观测：提供 jitter buffer 深度、播放缓冲、编码帧率等指标用于 UI 延迟面板

### 5.2 上行（麦克风 → 网关）

链路：

1. `getUserMedia({ audio })`
2. `AudioWorkletProcessor`：
   - 采样/重采样到 48k（如设备采样率不同）
   - 输入增益、门限
   - VAD（能量 + hangover，或后续替换更强方案）
   - 生成 20ms PCM frame
3. RNNoise（WASM，建议放 Worker，避免 Worklet 负载过高）
4. Opus Encoder（WebCodecs 优先；WASM 作为 fallback）
5. WS binary uplink 发送 Opus frame

### 5.3 下行（网关 → 扬声器）

链路：

1. WS binary downlink 收到（包含 userId + opusBytes）
2. Opus Decoder（WebCodecs 优先；WASM 作为 fallback）
3. per-user jitter buffer（以 timestamp/seq 对齐，保持目标缓冲深度）
4. `AudioWorkletProcessor` 混音输出到 `audioContext.destination`

### 5.4 性能演进路径

阶段 1：`postMessage + Transferable ArrayBuffer` 跑通功能。  
阶段 2（可选）：启用 `SharedArrayBuffer` + ring buffer，减少拷贝与 GC（需要 COOP/COEP headers）。

---

## 6. UI/UX（Next.js + Tailwind + shadcn/ui）

### 6.1 页面与布局

- `/`：连接页
  - 服务器下拉（白名单）
  - 用户名/密码/token
  - 默认加入频道（可选）
  - 历史记录与快速重连
- `/app`：主界面
  - 左：频道树（可折叠、右键/菜单加入）
  - 中：聊天（频道/私聊）
  - 右：用户列表（说话指示、静音/聋状态、当前频道）
  - 底部语音条：PTT/VAD、输入电平、降噪开关、静音/聋、延迟概览

### 6.2 状态管理与数据刷新

- 推荐 `zustand`（或等价轻量方案）：
  - `connectionStore`：连接状态、错误、重连
  - `mumbleStore`：channels/users/self/channel membership
  - `audioStore`：设备/增益/VAD/降噪/码率、jitter buffer 指标
  - `metricsStore`：WS RTT、Server RTT、丢包/抖动

---

## 7. 延迟展示（指标定义与呈现）

### 7.1 指标

- `WS RTT`：web⇄gateway ping/pong（ms）
- `Server RTT`：gateway⇄mumble `Ping`（ms）
- `Playout`：客户端 jitter buffer 深度（ms）+ 播放队列水位

### 7.2 UI 呈现

- 主界面状态栏常驻：`WS xx ms | Server xx ms | Buffer xx ms`
- 点击打开详情：近 N 次统计与趋势（可选）

---

## 8. 实施里程碑（建议顺序）

### M0：仓库结构与基础设施

- ✅ 已完成：
  - 引入 `pnpm-workspace.yaml`
  - 新增 `apps/web` 与 `apps/gateway` 基础工程与脚本
  - 保留旧版 `app/` 与 `webpack.config.js`（通过 `legacy:*` 脚本仍可构建旧版）

### M1：Gateway（无语音，先把“可用状态”跑通）

- ✅ 已完成（见 `apps/gateway/src/index.ts`）：
  - 白名单 `serverList`（`apps/gateway/config/servers.json`）
  - connect/auth（自实现 Mumble TCP/TLS + Protobuf 协议编解码）
  - 频道/用户 `stateSnapshot` + `channelUpsert/userUpsert` 增量更新
  - `joinChannel`
  - `textSend` / `textRecv`
  - `ping`/`pong`（WS RTT）与 `dataPing`（server RTT）metrics 推送

### M2：Web UI（无语音）

- ✅ 已完成（见 `apps/web/app`）：
  - 连接页（服务器白名单选择、用户名/密码/token）
  - 主界面骨架（频道树/用户列表/聊天/加入频道）
  - 设置面板占位（M3+ 接入音频设置）
  - 延迟显示占位：`WS RTT` 与 `Server RTT`

### M3：下行语音（先听得到）

- ✅ 已完成（见 `apps/gateway/src/index.ts` 与 `apps/web/src/audio/voice-engine.ts`）：
  - 网关：透传远端 Opus 帧（TCP `UDPTunnel`），并以 WS binary frame 下发（包含 userId/seq/flags + Opus bytes）
  - 前端：使用 WebCodecs（或后续 WASM 方案）解码为 PCM，并交给 `AudioWorklet` 播放与多用户混音（`apps/web/public/audio/playback-worklet.js`）

### M4：上行语音（能说）

- ✅ 已完成（见 `apps/web/public/audio/capture-worklet.js` 与 `apps/gateway/src/index.ts`）：
  - 前端：`AudioWorklet` 采集麦克风，支持 VAD/PTT gating，按 20ms（960 samples@48k）切帧，使用 WebCodecs（或后续 WASM 方案）编码为 Opus 后上送
  - 网关：收到上行 Opus 帧后封包，并通过 TCP `UDPTunnel` 发送到 Mumble 服务器
  - 传输：当前仅实现 TCP 语音隧道（`UDPTunnel`）；UDP 语音通道可在后续阶段补齐
  - 降噪：当前使用浏览器 `getUserMedia` 的内建 `noiseSuppression/echoCancellation/autoGainControl`；RNNoise(WASM) 计划在后续阶段接入

### M5：质量与体验打磨

- 延迟面板完善、丢包/抖动可视化
- 断线重连、错误提示与恢复路径
- 性能优化（可选 SAB/ring buffer、SIMD/threads）

### M6：清理旧实现与文档更新

- 移除旧 `webpack/knockout/webrtc` 相关代码与依赖（在新功能完全可用后）
- 更新 README：部署方式、反代配置、网关白名单配置、COOP/COEP（如启用）

---

## 9. 验收标准（Definition of Done）

- 前端完全不使用 WebRTC（代码与运行时均无 RTCPeerConnection 依赖）。
- 仅能连接白名单服务器（无法通过参数绕过）。
- 能显示频道树与用户列表，支持加入频道与收发文字消息。
- 语音可用：Opus 编解码、降噪可开关、VAD 可用（PTT 可选但建议保留），并支持 UDP 优先 + TCP 隧道 fallback。
- UI 中可见延迟：WS RTT、Server RTT、播放缓冲（至少三项）。
- 自托管部署可运行（文档完整，含配置示例与启动命令）。

---

## 10. 本地运行（当前 M0–M4）

### 10.1 配置白名单服务器

- 编辑 `apps/gateway/config/servers.json`，填入可连接的 Mumble 服务器（TCP/TLS 端口通常为 `64738`）。

### 10.2 启动（开发）

1. 安装依赖（需要网络）：
   - `pnpm install`
2. 启动网关：
   - `pnpm -C apps/gateway dev`（默认 `ws://localhost:64737/ws`；同时会尝试从 `apps/web/out` 提供静态页面）
3. 启动前端：
   - `pnpm -C apps/web dev`（默认 `http://localhost:3000`）

可选：使用根目录脚本同时启动：
- `pnpm dev:new`

### 10.3 前端连接网关

- 开发模式默认使用 `ws://localhost:64737/ws`；如需修改，设置环境变量：
  - `NEXT_PUBLIC_GATEWAY_WS_URL=ws://<host>:<port>/ws`
- 生产/同端口部署时，前端默认使用同源 `ws(s)://<host>/ws`（无需额外配置）。

### 10.4 语音使用（当前实现）

1. 在前端连接成功后，进入 `/app`
2. 先点击“启用音频”（浏览器自动播放策略要求用户手势）
3. 点击“开启麦克风”，并允许浏览器麦克风权限
4. 选择 `VAD` 或 `PTT`：
   - `VAD`：调节阈值让说话时稳定触发、静音时不触发
   - `PTT`：按住“按住说话”按钮发言
