# @mumble-web/gateway

WebSocket 网关（自托管），负责连接白名单 Mumble 服务器并向浏览器转发状态与消息。

## 配置

- 复制 `config/servers.example.json` 为 `config/servers.json` 并填入白名单服务器。
- 默认监听端口：`64737`（可用 `PORT` 覆盖）。

## 可选：开启 COOP/COEP（SharedArrayBuffer）

如需启用 `SharedArrayBuffer`（例如后续做音频 ring buffer、WASM threads），可设置：

- `COOP_COEP=1`（或 `COOP_COEP=true`）：对静态资源响应添加 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`

## 启动（开发）

```bash
pnpm -C apps/gateway dev
```
