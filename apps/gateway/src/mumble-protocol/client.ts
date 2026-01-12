import tls from 'node:tls'
import { setInterval, clearInterval } from 'node:timers'
import type { ChannelState, UserState } from '../types.js'
import {
  TcpMessageType,
  decodeChannelRemove,
  decodeChannelState,
  decodeCodecVersion,
  decodePermissionDenied,
  decodePing,
  decodeReject,
  decodeServerSync,
  decodeTextMessage,
  decodeUserRemove,
  decodeUserState,
  decodeVersion,
  encodeAuthenticate,
  encodePing,
  encodeTextMessage,
  encodeUserState,
  encodeVersion
} from './messages.js'
import { TypedEmitter } from './typed-emitter.js'

export type MumbleTextMessage = {
  actor: number
  message: string
  targetSessions: number[]
  targetChannelIds: number[]
  targetTreeIds: number[]
}

export type MumbleReject = {
  type?: number
  reason?: string
}

export type MumblePermissionDenied = {
  permission?: number
  channelId?: number
  session?: number
  reason?: string
  type?: number
  name?: string
}

export type MumbleServerInfo = {
  welcomeMessage?: string
  maxBandwidth?: number
  version?: ReturnType<typeof decodeVersion>
  opus?: boolean
}

type Events = {
  channelUpsert: ChannelState
  channelRemove: number
  userUpsert: UserState
  userRemove: number
  textMessage: MumbleTextMessage
  serverRtt: number
  serverSync: MumbleServerInfo
  udpTunnel: Buffer
  reject: MumbleReject
  denied: MumblePermissionDenied
  error: unknown
  disconnected: undefined
  // Voice events are added in a later module (see voice.ts integration)
}

function versionV1(major: number, minor: number, patch: number): number {
  return ((major & 0xffff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

export class MumbleTcpClient {
  private _socket: tls.TLSSocket
  private _buffer: Buffer = Buffer.alloc(0)
  private _closed = false
  private _keepaliveTimer: NodeJS.Timeout | null = null

  private _pendingPings = new Map<bigint, number>()

  readonly events = new TypedEmitter<Events>()

  readonly channels = new Map<number, ChannelState>()
  readonly users = new Map<number, UserState>()

  selfUserId = 0
  rootChannelId = 0
  serverInfo: MumbleServerInfo = {}

  constructor(socket: tls.TLSSocket) {
    this._socket = socket

    socket.on('data', (chunk) => this._onData(chunk))
    socket.once('close', () => this._onClose())
    socket.on('error', (err) => this.events.emit('error', err))
  }

  static async connect(params: {
    host: string
    port: number
    rejectUnauthorized: boolean
    username: string
    password?: string
    tokens?: string[]
  }): Promise<MumbleTcpClient> {
    const socket = tls.connect({
      host: params.host,
      port: params.port,
      servername: params.host,
      rejectUnauthorized: params.rejectUnauthorized
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => reject(err)
      socket.once('secureConnect', () => {
        socket.off('error', onError)
        resolve()
      })
      socket.once('error', onError)
    })

    const client = new MumbleTcpClient(socket)

    // Use protocol version < 1.5 to stick to legacy UDP packet format.
    client.sendMessage(TcpMessageType.Version, encodeVersion({
      versionV1: versionV1(1, 4, 0),
      release: 'mumble-web gateway',
      os: 'node',
      osVersion: process.version
    }))

    client.sendMessage(TcpMessageType.Authenticate, encodeAuthenticate({
      username: params.username,
      ...(params.password != null ? { password: params.password } : {}),
      ...(params.tokens != null ? { tokens: params.tokens } : {}),
      opus: true,
      clientType: 0
    }))

    // Keepalive ping (required by server; disconnects after ~30s without ping).
    client._keepaliveTimer = setInterval(() => {
      if (client._closed) return
      const ts = BigInt(Date.now())
      client._pendingPings.set(ts, Date.now())
      client.sendMessage(TcpMessageType.Ping, encodePing({ timestamp: ts }))
    }, 10_000)

    return client
  }

  close(): void {
    if (this._closed) return
    this._closed = true
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer)
    this._keepaliveTimer = null
    try {
      this._socket.end()
    } catch {}
    try {
      this._socket.destroy()
    } catch {}
  }

  sendMessage(type: TcpMessageType, payload: Buffer): void {
    if (this._closed) return
    const header = Buffer.allocUnsafe(6)
    header.writeUInt16BE(type, 0)
    header.writeUInt32BE(payload.length >>> 0, 2)
    try {
      this._socket.write(Buffer.concat([header, payload]))
    } catch (err) {
      this.events.emit('error', err)
    }
  }

  joinChannel(channelId: number): void {
    if (!Number.isFinite(channelId)) return
    const payload = encodeUserState({
      ...(this.selfUserId ? { session: this.selfUserId } : {}),
      channelId
    })
    this.sendMessage(TcpMessageType.UserState, payload)
  }

  sendTextMessage(params: { message: string; channelId?: number; userId?: number }): void {
    const message = params.message?.toString?.() ?? ''
    if (!message.trim()) return

    const targetSessions = params.userId != null ? [params.userId] : undefined
    const selfChannelId = this.selfUserId ? this.users.get(this.selfUserId)?.channelId : null
    const targetChannelId = params.userId == null ? (params.channelId ?? selfChannelId) : null
    const targetChannelIds = targetChannelId != null ? [targetChannelId] : undefined

    const payload = encodeTextMessage({
      message,
      ...(targetSessions ? { targetSessions } : {}),
      ...(targetChannelIds ? { targetChannelIds } : {})
    })

    this.sendMessage(TcpMessageType.TextMessage, payload)
  }

  private _onClose() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer)
    this._keepaliveTimer = null
    this._closed = true
    this.events.emit('disconnected', undefined)
  }

  private _onData(chunk: Buffer) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk

    while (this._buffer.length >= 6) {
      const type = this._buffer.readUInt16BE(0)
      const length = this._buffer.readUInt32BE(2)
      const total = 6 + length
      if (this._buffer.length < total) break

      const payload = this._buffer.subarray(6, total)
      this._buffer = this._buffer.subarray(total)

      this._handleMessage(type, payload)
    }
  }

  private _handleMessage(type: number, payload: Buffer) {
    try {
      switch (type) {
        case TcpMessageType.Version: {
          this.serverInfo.version = decodeVersion(payload)
          return
        }
        case TcpMessageType.Reject: {
          const rej = decodeReject(payload)
          this.events.emit('reject', rej)
          this.close()
          return
        }
        case TcpMessageType.ServerSync: {
          const sync = decodeServerSync(payload)
          if (sync.session != null) this.selfUserId = sync.session
          if (sync.maxBandwidth != null) this.serverInfo.maxBandwidth = sync.maxBandwidth
          if (sync.welcomeText != null) this.serverInfo.welcomeMessage = sync.welcomeText
          this.events.emit('serverSync', { ...this.serverInfo })
          return
        }
        case TcpMessageType.Ping: {
          const ping = decodePing(payload)
          if (ping.timestamp != null) {
            const sent = this._pendingPings.get(ping.timestamp)
            if (sent != null) {
              this._pendingPings.delete(ping.timestamp)
              this.events.emit('serverRtt', Date.now() - sent)
            }
          }
          return
        }
        case TcpMessageType.ChannelState: {
          const ch = decodeChannelState(payload)
          if (ch.channelId == null) return
          const prev = this.channels.get(ch.channelId)
          const linksPrev = prev?.links ?? []

          let links: number[] | undefined
          if (ch.links.length) {
            links = [...ch.links]
          } else if (ch.linksAdd.length || ch.linksRemove.length) {
            const set = new Set(linksPrev)
            for (const id of ch.linksAdd) set.add(id)
            for (const id of ch.linksRemove) set.delete(id)
            links = [...set]
          } else {
            links = prev?.links
          }

          const next: ChannelState = {
            id: ch.channelId,
            name: ch.name ?? prev?.name ?? '',
            parentId: ch.channelId === 0 ? null : (ch.parent ?? prev?.parentId ?? null)
          }
          const position = ch.position ?? prev?.position
          if (position != null) next.position = position
          const description = ch.description ?? prev?.description
          if (description != null) next.description = description
          if (links && links.length) next.links = links

          this.channels.set(next.id, next)
          this.events.emit('channelUpsert', next)
          return
        }
        case TcpMessageType.ChannelRemove: {
          const msg = decodeChannelRemove(payload)
          this.channels.delete(msg.channelId)
          this.events.emit('channelRemove', msg.channelId)
          return
        }
        case TcpMessageType.UserState: {
          const u = decodeUserState(payload)
          if (u.session == null) return
          const prev = this.users.get(u.session)
          const next: UserState = {
            id: u.session,
            name: u.name ?? prev?.name ?? '',
            // Murmur omits channel_id for *other users* when they are in the root channel (id=0).
            // Treat missing channel_id as "unchanged", and default to root (0) for first sight.
            channelId: u.channelId ?? prev?.channelId ?? 0
          }
          const mute = u.mute ?? prev?.mute
          const deaf = u.deaf ?? prev?.deaf
          const suppress = u.suppress ?? prev?.suppress
          const selfMute = u.selfMute ?? prev?.selfMute
          const selfDeaf = u.selfDeaf ?? prev?.selfDeaf
          if (mute != null) next.mute = mute
          if (deaf != null) next.deaf = deaf
          if (suppress != null) next.suppress = suppress
          if (selfMute != null) next.selfMute = selfMute
          if (selfDeaf != null) next.selfDeaf = selfDeaf
          this.users.set(next.id, next)
          this.events.emit('userUpsert', next)
          return
        }
        case TcpMessageType.UserRemove: {
          const msg = decodeUserRemove(payload)
          this.users.delete(msg.session)
          this.events.emit('userRemove', msg.session)
          return
        }
        case TcpMessageType.TextMessage: {
          const msg = decodeTextMessage(payload)
          this.events.emit('textMessage', {
            actor: msg.actor ?? 0,
            message: msg.message ?? '',
            targetSessions: msg.sessions,
            targetChannelIds: msg.channelIds,
            targetTreeIds: msg.treeIds
          })
          return
        }
        case TcpMessageType.PermissionDenied: {
          const denied = decodePermissionDenied(payload)
          this.events.emit('denied', denied)
          return
        }
        case TcpMessageType.CodecVersion: {
          const codec = decodeCodecVersion(payload)
          if (codec.opus != null) this.serverInfo.opus = codec.opus
          return
        }
        case TcpMessageType.UDPTunnel:
          this.events.emit('udpTunnel', payload)
          return
        case TcpMessageType.CryptSetup:
        default:
          return
      }
    } catch (err) {
      this.events.emit('error', err)
    }
  }
}
