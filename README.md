# mumble-web (Next.js + WebSocket gateway)

`mumble-web` 已重构为 **Next.js 静态前端 + 自托管 WebSocket 网关** 的架构：

- 浏览器仅连接网关（WebSocket），**不使用 WebRTC**
- 网关连接白名单内的 Mumble 服务器（TCP/TLS 控制面 + 语音通过协议内 `UDPTunnel` 透传）

实现细节与里程碑见 `REWRITE_PLAN.md`。

## 目录结构

- `apps/web/`：Next.js（`output: 'export'`）静态站点
- `apps/gateway/`：Node.js WebSocket 网关（同时可静态托管 `apps/web/out`）

## 快速开始（开发）

1) 配置白名单服务器：

- 复制 `apps/gateway/config/servers.example.json` 为 `apps/gateway/config/servers.json`
- 按需修改 `host/port/tls`

2) 安装依赖（需要网络）：

```bash
pnpm install
```

3) 启动前端与网关：

```bash
pnpm dev
```

- Web：`http://localhost:3000`
- Gateway WS：`ws://localhost:64737/ws`

## 构建与运行（生产/自托管）

```bash
pnpm build
pnpm start
```

默认监听 `64737`，并从 `apps/web/out` 提供静态页面：

- Web：`http://<host>:64737/`
- WS：`ws://<host>:64737/ws`

## 配置

### 白名单服务器

编辑 `apps/gateway/config/servers.json`：

```json
{
  "servers": [
    {
      "id": "local",
      "name": "Local Mumble",
      "host": "127.0.0.1",
      "port": 64738,
      "tls": { "rejectUnauthorized": false }
    }
  ]
}
```

### 环境变量

- `PORT`：网关监听端口（默认 `64737`）
- `WEB_ROOT`：静态站点目录（默认 `apps/web/out`）
- `NEXT_PUBLIC_GATEWAY_WS_URL`：前端直连网关 WS 地址（开发时可用；生产同源默认 `/ws`）
- `COOP_COEP=1`（或 `true`）：网关静态资源响应加 `COOP/COEP`，用于启用 `SharedArrayBuffer`

## 反向代理（Nginx 示例）

将站点与 WebSocket 都转发到网关（同域同端口最简单）：

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 443 ssl;
  server_name voice.example.com;

  # ssl_certificate ...
  # ssl_certificate_key ...

  location / {
    proxy_pass http://127.0.0.1:64737;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

如需启用 `SharedArrayBuffer`，可选择：

- 在网关进程设置 `COOP_COEP=1`
- 或在反代层添加：
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`

## Docker

```bash
docker build -t mumble-web .
docker run --rm -p 64737:64737 mumble-web
```

建议通过 volume 提供 `apps/gateway/config/servers.json`（白名单）并按需设置 `PORT`。

## 浏览器兼容性与语音说明

- 语音编解码当前使用 WebCodecs Opus，建议使用 Chrome/Edge 等支持 WebCodecs 的浏览器。
- 当前语音承载为 Mumble 协议内 `UDPTunnel`（TCP 隧道）；UDP 语音通道可在后续阶段补齐。

## License

ISC
