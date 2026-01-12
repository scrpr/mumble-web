import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'
import { loadServersConfig } from './config.js'
import { serveStaticFromDir } from './http-static.js'
import { connectMumbleServer } from './mumble.js'
import { debugError, debugLog } from './debug.js'
import { errorSummary, serializeError } from './error-utils.js'
import { safeJsonParse, sendJson } from './ws.js'
import type { GatewayClientMessage, GatewayServerMessage, ServerConfig } from './types.js'
import { VOICE_UPLINK_END, VOICE_UPLINK_OPUS, decodeUplinkVoiceMessage, encodeDownlinkOpus } from './voice-protocol.js'

type Session = {
  serverId: string
  server: ServerConfig
  mumble: Awaited<ReturnType<typeof connectMumbleServer>>
  mumbleUnsubscribers: Array<() => void>
  metrics: {
    lastServerRttMs?: number
    voiceDownlinkFrames: number
    voiceDownlinkBytes: number
    voiceDownlinkDroppedFrames: number
    voiceUplinkFrames: number
    voiceUplinkBytes: number
    lastMetricsAtMs?: number
    lastVoiceDownlinkFrames?: number
    lastVoiceDownlinkBytes?: number
    lastVoiceDownlinkDroppedFrames?: number
    lastVoiceUplinkFrames?: number
    lastVoiceUplinkBytes?: number
  }
}

const PORT = Number(process.env.PORT ?? 64737)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const WEB_ROOT = process.env.WEB_ROOT ? path.resolve(process.env.WEB_ROOT) : path.resolve(__dirname, '../../web/out')
const hasWebRoot = fs.existsSync(WEB_ROOT) && fs.statSync(WEB_ROOT).isDirectory()

const servers = loadServersConfig()
const serverListPayload = servers.map((s) => ({ id: s.id, name: s.name }))

const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (hasWebRoot) {
    const handled = serveStaticFromDir(req, res, WEB_ROOT)
    if (handled) return
  }

  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/ws' && url.pathname !== '/') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

function sendError(ws: WebSocket, code: string, message: string, details?: unknown) {
  sendJson(ws, { type: 'error', code, message, ...(details != null ? { details: serializeError(details) } : {}) })
}

function sendMetrics(ws: WebSocket, session: Session) {
  const now = Date.now()
  const msg: GatewayServerMessage = { type: 'metrics' }
  if (session.metrics.lastServerRttMs != null) msg.serverRttMs = session.metrics.lastServerRttMs
  msg.wsBufferedAmountBytes = ws.bufferedAmount

  msg.voiceDownlinkFramesTotal = session.metrics.voiceDownlinkFrames
  msg.voiceDownlinkBytesTotal = session.metrics.voiceDownlinkBytes
  msg.voiceDownlinkDroppedFramesTotal = session.metrics.voiceDownlinkDroppedFrames
  msg.voiceUplinkFramesTotal = session.metrics.voiceUplinkFrames
  msg.voiceUplinkBytesTotal = session.metrics.voiceUplinkBytes

  const prevAtMs = session.metrics.lastMetricsAtMs
  if (prevAtMs != null) {
    const dtSec = (now - prevAtMs) / 1000
    if (dtSec > 0) {
      const downFramesDelta = session.metrics.voiceDownlinkFrames - (session.metrics.lastVoiceDownlinkFrames ?? session.metrics.voiceDownlinkFrames)
      const downBytesDelta = session.metrics.voiceDownlinkBytes - (session.metrics.lastVoiceDownlinkBytes ?? session.metrics.voiceDownlinkBytes)
      const downDroppedDelta =
        session.metrics.voiceDownlinkDroppedFrames -
        (session.metrics.lastVoiceDownlinkDroppedFrames ?? session.metrics.voiceDownlinkDroppedFrames)
      const upFramesDelta = session.metrics.voiceUplinkFrames - (session.metrics.lastVoiceUplinkFrames ?? session.metrics.voiceUplinkFrames)
      const upBytesDelta = session.metrics.voiceUplinkBytes - (session.metrics.lastVoiceUplinkBytes ?? session.metrics.voiceUplinkBytes)

      msg.voiceDownlinkFps = downFramesDelta / dtSec
      msg.voiceDownlinkKbps = (downBytesDelta * 8) / 1000 / dtSec
      msg.voiceDownlinkDroppedFps = downDroppedDelta / dtSec
      msg.voiceUplinkFps = upFramesDelta / dtSec
      msg.voiceUplinkKbps = (upBytesDelta * 8) / 1000 / dtSec
    }
  }

  session.metrics.lastMetricsAtMs = now
  session.metrics.lastVoiceDownlinkFrames = session.metrics.voiceDownlinkFrames
  session.metrics.lastVoiceDownlinkBytes = session.metrics.voiceDownlinkBytes
  session.metrics.lastVoiceDownlinkDroppedFrames = session.metrics.voiceDownlinkDroppedFrames
  session.metrics.lastVoiceUplinkFrames = session.metrics.voiceUplinkFrames
  session.metrics.lastVoiceUplinkBytes = session.metrics.voiceUplinkBytes
  sendJson(ws, msg)
}

function assertClientMessage(msg: unknown): GatewayClientMessage | null {
  if (!msg || typeof msg !== 'object') return null
  const type = (msg as any).type
  if (type === 'connect' || type === 'disconnect' || type === 'joinChannel' || type === 'textSend' || type === 'ping') {
    return msg as GatewayClientMessage
  }
  return null
}

function attachMumbleEventForwarders(ws: WebSocket, session: Session): Array<() => void> {
  const client = session.mumble.client

  const send: (m: GatewayServerMessage) => void = (m) => sendJson(ws, m)
  const unsubs: Array<() => void> = []

  unsubs.push(
    client.events.on('channelUpsert', (channel) => send({ type: 'channelUpsert', channel })),
    client.events.on('channelRemove', (channelId) => send({ type: 'channelRemove', channelId })),
    client.events.on('userUpsert', (user) => send({ type: 'userUpsert', user })),
    client.events.on('userRemove', (userId) => send({ type: 'userRemove', userId })),
    client.events.on('textMessage', (m) => {
      send({
        type: 'textRecv',
        senderId: m.actor ?? 0,
        message: m.message,
        targetUsers: m.targetSessions ?? [],
        targetChannels: m.targetChannelIds ?? [],
        targetTrees: m.targetTreeIds ?? [],
        timestampMs: Date.now()
      })
    }),
    client.events.on('serverRtt', (durationMs) => {
      session.metrics.lastServerRttMs = durationMs
      sendMetrics(ws, session)
    }),
    client.events.on('reject', (rejectInfo) => {
      sendError(ws, 'mumble_reject', 'Connection rejected by server', rejectInfo)
    }),
    client.events.on('denied', (denied) => {
      sendError(ws, 'mumble_denied', 'Permission denied', denied)
    }),
    client.events.on('error', (err) => {
      sendError(ws, 'mumble_error', 'Mumble client error', err)
    }),
    client.events.on('disconnected', () => {
      send({ type: 'disconnected', reason: 'mumble_disconnect' })
    }),
    client.events.on('voiceOpus', (frame) => {
      if (ws.readyState !== ws.OPEN) return
      const msg = encodeDownlinkOpus({
        userId: frame.userId,
        target: frame.target,
        sequence: Number(frame.sequence & 0xffffffffn),
        isLastFrame: frame.isLastFrame,
        opus: frame.opus
      })

      // Best-effort realtime delivery: drop if buffered too much.
      if (ws.bufferedAmount > 2_000_000) {
        session.metrics.voiceDownlinkDroppedFrames += 1
        return
      }
      ws.send(msg)
      session.metrics.voiceDownlinkFrames += 1
      session.metrics.voiceDownlinkBytes += msg.byteLength
    })
  )

  return unsubs
}

wss.on('connection', (ws) => {
  sendJson(ws, { type: 'serverList', servers: serverListPayload })

  let session: Session | null = null
  let metricsInterval: NodeJS.Timeout | null = null

  const cleanup = () => {
    if (metricsInterval) clearInterval(metricsInterval)
    metricsInterval = null
    if (session) {
      for (const off of session.mumbleUnsubscribers) {
        try {
          off()
        } catch {}
      }
      session.mumbleUnsubscribers = []
      try {
        session.mumble.close()
      } catch {}
    }
    session = null
  }

  ws.on('message', async (data) => {
    if (Array.isArray(data)) {
      data = Buffer.concat(data)
    } else if (data instanceof ArrayBuffer) {
      data = Buffer.from(data)
    }

    if (Buffer.isBuffer(data)) {
      const kind = data.readUInt8(0)
      const isVoiceUplink = kind === VOICE_UPLINK_OPUS || kind === VOICE_UPLINK_END
      if (isVoiceUplink) {
        if (!session) return
        const decoded = decodeUplinkVoiceMessage(data)
        if (!decoded) return

        const client = session.mumble.client
        if (decoded.type === 'end') {
          try {
            client.sendOpusEnd(0)
          } catch {}
          return
        }

        try {
          if (decoded.type !== 'opus') return
          session.metrics.voiceUplinkFrames += 1
          session.metrics.voiceUplinkBytes += decoded.opus.byteLength
          client.sendOpusFrame(decoded.target, decoded.opus)
        } catch {}
        return
      }
    }

    const text = typeof data === 'string' ? data : data.toString('utf8')
    const parsed = safeJsonParse(text)
    const msg = assertClientMessage(parsed)
    if (!msg) {
      sendError(ws, 'bad_request', 'Invalid message')
      return
    }

    if (msg.type === 'ping') {
      const now = Date.now()
      sendJson(ws, { type: 'pong', clientTimeMs: msg.clientTimeMs, serverTimeMs: now })
      if (session) {
        sendMetrics(ws, session)
      }
      return
    }

    if (msg.type === 'disconnect') {
      cleanup()
      sendJson(ws, { type: 'disconnected', reason: 'client_disconnect' })
      return
    }

    if (msg.type === 'connect') {
      cleanup()

      const server = servers.find((s) => s.id === msg.serverId)
      if (!server) {
        sendError(ws, 'unknown_server', 'Unknown serverId')
        return
      }

      debugLog(`[gateway] connect: serverId=${server.id} host=${server.host} port=${server.port} username=${msg.username}`)

      try {
        const mumble = await connectMumbleServer({
          server,
          username: msg.username,
          ...(msg.password != null ? { password: msg.password } : {}),
          ...(msg.tokens != null ? { tokens: msg.tokens } : {})
        })

        session = {
          serverId: server.id,
          server,
          mumble,
          mumbleUnsubscribers: [],
          metrics: {
            voiceDownlinkFrames: 0,
            voiceDownlinkBytes: 0,
            voiceDownlinkDroppedFrames: 0,
            voiceUplinkFrames: 0,
            voiceUplinkBytes: 0
          }
        }

        const client = mumble.client
        const connectedMsg: GatewayServerMessage = {
          type: 'connected',
          serverId: server.id,
          selfUserId: client.selfUserId,
          rootChannelId: client.rootChannelId
        }
        if (client.welcomeMessage != null) connectedMsg.welcomeMessage = client.welcomeMessage
        if (client.serverVersion != null) connectedMsg.serverVersion = client.serverVersion
        if (client.maxBandwidth != null) connectedMsg.maxBandwidth = client.maxBandwidth
        sendJson(ws, connectedMsg)

        sendJson(ws, {
          type: 'stateSnapshot',
          channels: client.channels.sort((a, b) => a.id - b.id),
          users: client.users.sort((a, b) => a.id - b.id)
        })

        session.mumbleUnsubscribers = attachMumbleEventForwarders(ws, session)

        metricsInterval = setInterval(() => {
          if (!session) return
          sendMetrics(ws, session)
        }, 2000)
      } catch (err) {
        const summary = errorSummary(err)
        debugError(`[gateway] connect_failed: ${server.host}:${server.port} (${server.id}): ${summary}`, err)
        sendError(ws, 'connect_failed', `Failed to connect to Mumble server: ${summary}`, err)
      }

      return
    }

    if (!session) {
      sendError(ws, 'not_connected', 'Not connected')
      return
    }

    if (msg.type === 'joinChannel') {
      const client = session.mumble.client
      client.joinChannel(msg.channelId)
      return
    }

    if (msg.type === 'textSend') {
      const client = session.mumble.client
      const params: { message: string; channelId?: number; userId?: number } = { message: msg.message }
      if (msg.channelId != null) params.channelId = msg.channelId
      if (msg.userId != null) params.userId = msg.userId
      client.sendTextMessage(params)
      return
    }
  })

  ws.on('close', () => {
    cleanup()
  })
})

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[gateway] listening on http://localhost:${PORT} (ws://localhost:${PORT}/ws)`)
  if (hasWebRoot) {
    // eslint-disable-next-line no-console
    console.log(`[gateway] serving web from ${WEB_ROOT}`)
  } else {
    // eslint-disable-next-line no-console
    console.log(`[gateway] web not found at ${WEB_ROOT} (run: pnpm -C apps/web build)`)
  }
})
