import { ProtobufReader, ProtobufWriter } from './protobuf.js'

export enum TcpMessageType {
  Version = 0,
  UDPTunnel = 1,
  Authenticate = 2,
  Ping = 3,
  Reject = 4,
  ServerSync = 5,
  ChannelRemove = 6,
  ChannelState = 7,
  UserRemove = 8,
  UserState = 9,
  TextMessage = 11,
  PermissionDenied = 12,
  CryptSetup = 15,
  CodecVersion = 21
}

export type VersionMessage = {
  versionV1?: number
  versionV2?: bigint
  release?: string
  os?: string
  osVersion?: string
}

export function encodeVersion(msg: VersionMessage): Buffer {
  const w = new ProtobufWriter()
  if (msg.versionV1 != null) w.uint32(1, msg.versionV1)
  if (msg.release != null) w.string(2, msg.release)
  if (msg.os != null) w.string(3, msg.os)
  if (msg.osVersion != null) w.string(4, msg.osVersion)
  if (msg.versionV2 != null) w.uint64(5, msg.versionV2)
  return w.finish()
}

export function decodeVersion(buf: Buffer): VersionMessage {
  const r = new ProtobufReader(buf)
  const out: VersionMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.versionV1 = r.readUint32()
        break
      case 2:
        out.release = r.readString()
        break
      case 3:
        out.os = r.readString()
        break
      case 4:
        out.osVersion = r.readString()
        break
      case 5:
        out.versionV2 = r.readUint64()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type AuthenticateMessage = {
  username: string
  password?: string
  tokens?: string[]
  opus?: boolean
  clientType?: number
}

export function encodeAuthenticate(msg: AuthenticateMessage): Buffer {
  const w = new ProtobufWriter()
  w.string(1, msg.username)
  if (msg.password != null) w.string(2, msg.password)
  for (const token of msg.tokens ?? []) w.string(3, token)
  if (msg.opus != null) w.bool(5, msg.opus)
  if (msg.clientType != null) w.int32(6, msg.clientType)
  return w.finish()
}

export type PingMessage = {
  timestamp?: bigint
}

export function encodePing(msg: PingMessage): Buffer {
  const w = new ProtobufWriter()
  if (msg.timestamp != null) w.uint64(1, msg.timestamp)
  return w.finish()
}

export function decodePing(buf: Buffer): PingMessage {
  const r = new ProtobufReader(buf)
  const out: PingMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    if (tag.fieldNumber === 1) {
      out.timestamp = r.readUint64()
    } else {
      r.skip(tag.wireType)
    }
  }
  return out
}

export type RejectMessage = {
  type?: number
  reason?: string
}

export function decodeReject(buf: Buffer): RejectMessage {
  const r = new ProtobufReader(buf)
  const out: RejectMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.type = r.readUint32()
        break
      case 2:
        out.reason = r.readString()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type ServerSyncMessage = {
  session?: number
  maxBandwidth?: number
  welcomeText?: string
  permissions?: bigint
}

export function decodeServerSync(buf: Buffer): ServerSyncMessage {
  const r = new ProtobufReader(buf)
  const out: ServerSyncMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.session = r.readUint32()
        break
      case 2:
        out.maxBandwidth = r.readUint32()
        break
      case 3:
        out.welcomeText = r.readString()
        break
      case 4:
        out.permissions = r.readUint64()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type ChannelStateMessage = {
  channelId?: number
  parent?: number
  name?: string
  links: number[]
  linksAdd: number[]
  linksRemove: number[]
  description?: string
  position?: number
}

export function decodeChannelState(buf: Buffer): ChannelStateMessage {
  const r = new ProtobufReader(buf)
  const out: ChannelStateMessage = { links: [], linksAdd: [], linksRemove: [] }
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.channelId = r.readUint32()
        break
      case 2:
        out.parent = r.readUint32()
        break
      case 3:
        out.name = r.readString()
        break
      case 4:
        out.links.push(r.readUint32())
        break
      case 5:
        out.description = r.readString()
        break
      case 6:
        out.linksAdd.push(r.readUint32())
        break
      case 7:
        out.linksRemove.push(r.readUint32())
        break
      case 9:
        out.position = r.readInt32()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type ChannelRemoveMessage = {
  channelId: number
}

export function decodeChannelRemove(buf: Buffer): ChannelRemoveMessage {
  const r = new ProtobufReader(buf)
  let channelId: number | undefined
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    if (tag.fieldNumber === 1) {
      channelId = r.readUint32()
    } else {
      r.skip(tag.wireType)
    }
  }
  if (channelId == null) throw new Error('ChannelRemove missing channel_id')
  return { channelId }
}

export type UserStateMessage = {
  session?: number
  name?: string
  channelId?: number
  mute?: boolean
  deaf?: boolean
  suppress?: boolean
  selfMute?: boolean
  selfDeaf?: boolean
}

export function decodeUserState(buf: Buffer): UserStateMessage {
  const r = new ProtobufReader(buf)
  const out: UserStateMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.session = r.readUint32()
        break
      case 3:
        out.name = r.readString()
        break
      case 5:
        out.channelId = r.readUint32()
        break
      case 6:
        out.mute = r.readBool()
        break
      case 7:
        out.deaf = r.readBool()
        break
      case 8:
        out.suppress = r.readBool()
        break
      case 9:
        out.selfMute = r.readBool()
        break
      case 10:
        out.selfDeaf = r.readBool()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type UserRemoveMessage = {
  session: number
}

export function decodeUserRemove(buf: Buffer): UserRemoveMessage {
  const r = new ProtobufReader(buf)
  let session: number | undefined
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    if (tag.fieldNumber === 1) {
      session = r.readUint32()
    } else {
      r.skip(tag.wireType)
    }
  }
  if (session == null) throw new Error('UserRemove missing session')
  return { session }
}

export type TextMessageMessage = {
  actor?: number
  sessions: number[]
  channelIds: number[]
  treeIds: number[]
  message?: string
}

export function decodeTextMessage(buf: Buffer): TextMessageMessage {
  const r = new ProtobufReader(buf)
  const out: TextMessageMessage = { sessions: [], channelIds: [], treeIds: [] }
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.actor = r.readUint32()
        break
      case 2:
        out.sessions.push(r.readUint32())
        break
      case 3:
        out.channelIds.push(r.readUint32())
        break
      case 4:
        out.treeIds.push(r.readUint32())
        break
      case 5:
        out.message = r.readString()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type PermissionDeniedMessage = {
  permission?: number
  channelId?: number
  session?: number
  reason?: string
  type?: number
  name?: string
}

export function decodePermissionDenied(buf: Buffer): PermissionDeniedMessage {
  const r = new ProtobufReader(buf)
  const out: PermissionDeniedMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    switch (tag.fieldNumber) {
      case 1:
        out.permission = r.readUint32()
        break
      case 2:
        out.channelId = r.readUint32()
        break
      case 3:
        out.session = r.readUint32()
        break
      case 4:
        out.reason = r.readString()
        break
      case 5:
        out.type = r.readUint32()
        break
      case 6:
        out.name = r.readString()
        break
      default:
        r.skip(tag.wireType)
        break
    }
  }
  return out
}

export type CodecVersionMessage = {
  opus?: boolean
}

export function decodeCodecVersion(buf: Buffer): CodecVersionMessage {
  const r = new ProtobufReader(buf)
  const out: CodecVersionMessage = {}
  for (;;) {
    const tag = r.readTag()
    if (!tag) break
    if (tag.fieldNumber === 4) {
      out.opus = r.readBool()
    } else {
      r.skip(tag.wireType)
    }
  }
  return out
}

export type OutboundTextMessage = {
  message: string
  targetSessions?: number[]
  targetChannelIds?: number[]
  targetTreeIds?: number[]
}

export function encodeTextMessage(msg: OutboundTextMessage): Buffer {
  const w = new ProtobufWriter()
  for (const s of msg.targetSessions ?? []) w.uint32(2, s)
  for (const c of msg.targetChannelIds ?? []) w.uint32(3, c)
  for (const t of msg.targetTreeIds ?? []) w.uint32(4, t)
  w.string(5, msg.message)
  return w.finish()
}

export type OutboundUserState = {
  session?: number
  channelId?: number
}

export function encodeUserState(msg: OutboundUserState): Buffer {
  const w = new ProtobufWriter()
  if (msg.session != null) w.uint32(1, msg.session)
  if (msg.channelId != null) w.uint32(5, msg.channelId)
  return w.finish()
}
