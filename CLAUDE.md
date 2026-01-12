# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mumble-web 是一个 Mumble 语音通信的 Web 客户端，采用 **Next.js 静态前端 + Node.js WebSocket 网关** 架构，不使用 WebRTC。

## Development Commands

```bash
# 安装依赖
pnpm install

# 开发模式（同时启动前端和网关）
pnpm dev
# - Web: http://localhost:3000
# - Gateway WS: ws://localhost:64737/ws

# 构建
pnpm build

# 生产运行（仅网关，同时托管静态站点）
pnpm start
# - http://localhost:64737 (静态站点 + WebSocket)
```

### 单独运行子项目

```bash
# 仅网关开发
pnpm -C apps/gateway dev

# 仅前端开发
pnpm -C apps/web dev

# 单独构建
pnpm -C apps/gateway build
pnpm -C apps/web build
```

## Architecture

```
mumble-web/
├── apps/
│   ├── gateway/          # Node.js WebSocket 网关 (@mumble-web/gateway)
│   │   └── src/
│   │       ├── index.ts              # 入口：HTTP + WebSocket 服务器
│   │       ├── mumble.ts             # Mumble 服务器连接封装
│   │       ├── mumble-protocol/      # Mumble TCP 协议实现
│   │       │   ├── client.ts         # TLS 客户端，处理协议消息
│   │       │   ├── messages.ts       # Protobuf 编解码
│   │       │   └── voice-legacy.ts   # 语音包解析（UDPTunnel）
│   │       ├── voice-protocol.ts     # 前端<->网关 语音二进制协议
│   │       └── config.ts             # 服务器白名单配置加载
│   │
│   └── web/              # Next.js 静态前端 (@mumble-web/web)
│       ├── app/                      # App Router 页面
│       ├── src/
│       │   ├── state/gateway-store.ts   # Zustand 状态管理（WebSocket 通信）
│       │   └── audio/
│       │       ├── voice-engine.ts      # 音频引擎（AudioWorklet）
│       │       └── webcodecs-opus.ts    # WebCodecs Opus 编解码
│       ├── components/ui/            # shadcn/ui 组件
│       └── public/audio/             # AudioWorklet 脚本
```

## Key Technical Details

### 通信流程
1. 浏览器通过 WebSocket 连接网关 (`/ws`)
2. 网关通过 TLS 连接 Mumble 服务器（TCP 控制面）
3. 语音通过 Mumble 协议内 `UDPTunnel` 透传（非真 UDP）

### 前端状态管理
- `gateway-store.ts`: Zustand store，管理 WebSocket 连接、频道/用户状态、语音数据流
- 支持自动重连（网关断开、会话断开）

### 语音处理
- 编解码: WebCodecs Opus API
- 采样率: 48kHz
- 帧大小: 960 samples (20ms)
- AudioWorklet 用于采集和播放

### 配置
- 服务器白名单: `apps/gateway/config/servers.json`（从 `servers.example.json` 复制）
- 环境变量:
  - `PORT`: 网关端口（默认 64737）
  - `NEXT_PUBLIC_GATEWAY_WS_URL`: 前端 WebSocket 地址（开发时）

## Tech Stack

- **Monorepo**: pnpm workspaces
- **前端**: Next.js 16 (静态导出), React 19, Zustand, Tailwind CSS, shadcn/ui
- **网关**: Node.js, TypeScript, ws, tsx (开发热重载)
- **语音**: WebCodecs Opus, AudioWorklet
- **协议**: Mumble Protocol (Protobuf over TLS)
