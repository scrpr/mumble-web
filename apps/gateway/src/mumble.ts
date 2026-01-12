import type { ChannelState, ServerConfig, UserState } from './types.js'
import { MumbleTcpClient, type MumblePermissionDenied, type MumbleReject, type MumbleTextMessage } from './mumble-protocol/client.js'
import { TcpMessageType } from './mumble-protocol/messages.js'
import { decodeLegacyVoicePacketFromServer, encodeLegacyOpusPacketFromClient } from './mumble-protocol/voice-legacy.js'
import { TypedEmitter } from './mumble-protocol/typed-emitter.js'

export type ConnectedMumble = {
  client: MumbleSession
  voiceTransport: 'tcp-tunnel'
  close: () => void
}

export type VoiceOpusFrame = {
  userId: number
  target: number
  sequence: bigint
  isLastFrame: boolean
  opus: Buffer
}

type SessionEvents = {
  channelUpsert: ChannelState
  channelRemove: number
  userUpsert: UserState
  userRemove: number
  textMessage: MumbleTextMessage
  serverRtt: number
  reject: MumbleReject
  denied: MumblePermissionDenied
  voiceOpus: VoiceOpusFrame
  error: unknown
  disconnected: undefined
}

export class MumbleSession {
  private _tcp: MumbleTcpClient
  private _outSequence = 0n
  private _unsubscribers: Array<() => void> = []

  readonly events = new TypedEmitter<SessionEvents>()

  constructor(tcp: MumbleTcpClient) {
    this._tcp = tcp

    this._unsubscribers.push(
      tcp.events.on('channelUpsert', (ch) => this.events.emit('channelUpsert', ch)),
      tcp.events.on('channelRemove', (id) => this.events.emit('channelRemove', id)),
      tcp.events.on('userUpsert', (u) => this.events.emit('userUpsert', u)),
      tcp.events.on('userRemove', (id) => this.events.emit('userRemove', id)),
      tcp.events.on('textMessage', (m) => this.events.emit('textMessage', m)),
      tcp.events.on('serverRtt', (ms) => this.events.emit('serverRtt', ms)),
      tcp.events.on('reject', (r) => this.events.emit('reject', r)),
      tcp.events.on('denied', (d) => this.events.emit('denied', d)),
      tcp.events.on('error', (e) => this.events.emit('error', e)),
      tcp.events.on('disconnected', () => this.events.emit('disconnected', undefined)),
      tcp.events.on('udpTunnel', (pkt) => this._onTunnelPacket(pkt))
    )
  }

  get selfUserId() {
    return this._tcp.selfUserId
  }

  get rootChannelId() {
    return this._tcp.rootChannelId
  }

  get welcomeMessage() {
    return this._tcp.serverInfo.welcomeMessage
  }

  get serverVersion() {
    return this._tcp.serverInfo.version
  }

  get maxBandwidth() {
    return this._tcp.serverInfo.maxBandwidth
  }

  get channels(): ChannelState[] {
    return [...this._tcp.channels.values()]
  }

  get users(): UserState[] {
    return [...this._tcp.users.values()]
  }

  close(): void {
    for (const off of this._unsubscribers) {
      try {
        off()
      } catch {}
    }
    this._unsubscribers = []

    this._tcp.close()
  }

  joinChannel(channelId: number): void {
    this._tcp.joinChannel(channelId)
  }

  sendTextMessage(params: { message: string; channelId?: number; userId?: number }): void {
    this._tcp.sendTextMessage(params)
  }

  sendOpusFrame(target: number, opus: Buffer): void {
    const packet = encodeLegacyOpusPacketFromClient({
      target,
      sequence: this._outSequence++,
      opusData: opus,
      isLastFrame: false
    })
    this._tcp.sendMessage(TcpMessageType.UDPTunnel, packet)
  }

  sendOpusEnd(target: number): void {
    const packet = encodeLegacyOpusPacketFromClient({
      target,
      sequence: this._outSequence++,
      opusData: Buffer.alloc(0),
      isLastFrame: true
    })
    this._tcp.sendMessage(TcpMessageType.UDPTunnel, packet)
  }

  private _onTunnelPacket(packet: Buffer): void {
    const decoded = decodeLegacyVoicePacketFromServer(packet)
    if (!decoded) return
    if (decoded.kind !== 'opus') return
    this.events.emit('voiceOpus', {
      userId: decoded.sessionId,
      target: decoded.target,
      sequence: decoded.sequence,
      isLastFrame: decoded.isLastFrame,
      opus: Buffer.from(decoded.opusData)
    })
  }
}

export async function connectMumbleServer(params: {
  server: ServerConfig
  username: string
  password?: string
  tokens?: string[]
}): Promise<ConnectedMumble> {
  const { server, username, password, tokens } = params

  const tcp = await MumbleTcpClient.connect({
    host: server.host,
    port: server.port,
    rejectUnauthorized: server.tls?.rejectUnauthorized ?? true,
    username,
    ...(password != null ? { password } : {}),
    ...(tokens != null ? { tokens } : {})
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for ServerSync'))
    }, 15_000)

    const cleanup = () => {
      clearTimeout(timeout)
      offSync()
      offReject()
      offErr()
      offDisc()
    }

    const offSync = tcp.events.on('serverSync', () => {
      cleanup()
      resolve()
    })

    const offReject = tcp.events.on('reject', (rej) => {
      cleanup()
      reject(new Error(`Connection rejected: ${rej.reason ?? 'unknown'}`))
    })

    const offErr = tcp.events.on('error', (err) => {
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    })

    const offDisc = tcp.events.on('disconnected', () => {
      cleanup()
      reject(new Error('Disconnected before ServerSync'))
    })
  })

  const session = new MumbleSession(tcp)

  return {
    client: session,
    voiceTransport: 'tcp-tunnel',
    close: () => session.close()
  }
}
