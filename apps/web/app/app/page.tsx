'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { useGatewayStore } from '../../src/state/gateway-store'
import { cn } from '../../src/ui/cn'
import { VoiceEngine } from '../../src/audio/voice-engine'
import { canUseWebCodecsOpus, createWebCodecsOpusDecoder, createWebCodecsOpusEncoder } from '../../src/audio/webcodecs-opus'

export default function AppPage() {
  const {
    gatewayStatus,
    status,
    channelsById,
    usersById,
    rootChannelId,
    selfUserId,
    selectedChannelId,
    selectChannel,
    joinSelectedChannel,
    sendTextToSelectedChannel,
    chat,
    metrics,
    disconnect,
    init,
    connectError,
    clearError,
    setVoiceSink,
    sendMicOpus,
    sendMicEnd
  } = useGatewayStore()

  const webCodecsAvailable = canUseWebCodecsOpus()

  const [message, setMessage] = useState('')
  const [audioReady, setAudioReady] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [voiceMode, setVoiceMode] = useState<'vad' | 'ptt'>('vad')
  const [vadThreshold, setVadThreshold] = useState(0.02)
  const [playbackStats, setPlaybackStats] = useState<{ totalQueuedMs: number; maxQueuedMs: number; streams: number } | null>(null)
  const [captureStats, setCaptureStats] = useState<{ rms: number; sending: boolean } | null>(null)
  const voiceRef = useRef<VoiceEngine | null>(null)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    const decoders = new Map<number, ReturnType<typeof createWebCodecsOpusDecoder>>()

    let encoder: ReturnType<typeof createWebCodecsOpusEncoder> | null = null
    if (canUseWebCodecsOpus()) {
      try {
        encoder = createWebCodecsOpusEncoder({
          sampleRate: 48000,
          channels: 1,
          bitrate: 24000,
          onOpus: (opus) => sendMicOpus(opus, { target: 0 })
        })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[voice] failed to init WebCodecs Opus encoder: ${String(e)}`)
      }
    }

    const engine = new VoiceEngine({
      onMicPcm: (pcm, sampleRate) => {
        if (sampleRate !== 48000) return
        encoder?.encode(pcm)
      },
      onMicEnd: () => {
        if (!encoder) {
          sendMicEnd()
          return
        }
        encoder
          .flush()
          .catch(() => {})
          .finally(() => sendMicEnd())
      },
      onPlaybackStats: (s) => setPlaybackStats(s),
      onCaptureStats: (s) => setCaptureStats(s)
    })
    voiceRef.current = engine

    setVoiceSink((frame) => {
      if (!canUseWebCodecsOpus()) return
      if (!frame.opus.byteLength) return

      let dec = decoders.get(frame.userId)
      if (!dec) {
        try {
          dec = createWebCodecsOpusDecoder({
            sampleRate: 48000,
            channels: 1,
            onPcm: (pcm) => engine.pushRemotePcm({ userId: frame.userId, channels: 1, sampleRate: 48000, pcm })
          })
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[voice] failed to init WebCodecs Opus decoder: ${String(e)}`)
          return
        }
        decoders.set(frame.userId, dec)
      }

      dec.decode(frame.opus)
    })

    return () => {
      setVoiceSink(null)
      engine.disableMic()
      encoder?.close()
      for (const dec of decoders.values()) dec.close()
    }
  }, [sendMicEnd, sendMicOpus, setVoiceSink])

  useEffect(() => {
    if (status !== 'connected') {
      voiceRef.current?.disableMic()
      setMicEnabled(false)
    }
  }, [status])

  const root = rootChannelId != null ? channelsById[rootChannelId] : undefined

  const channelTree = useMemo(() => {
    if (rootChannelId == null) return []
    const all = Object.values(channelsById)
    const byParent = new Map<number | null, number[]>()
    for (const ch of all) {
      const key = ch.parentId ?? null
      const arr = byParent.get(key) ?? []
      arr.push(ch.id)
      byParent.set(key, arr)
    }
    for (const [, ids] of byParent) ids.sort((a, b) => (channelsById[a]?.name ?? '').localeCompare(channelsById[b]?.name ?? ''))

    const build = (parentId: number | null, depth: number): Array<{ id: number; depth: number }> => {
      const ids = byParent.get(parentId) ?? []
      const out: Array<{ id: number; depth: number }> = []
      for (const id of ids) {
        out.push({ id, depth })
        out.push(...build(id, depth + 1))
      }
      return out
    }

    return build(null, 0)
  }, [channelsById, rootChannelId])

  const usersInSelectedChannel = useMemo(() => {
    if (selectedChannelId == null) return []
    return Object.values(usersById)
      .filter((u) => u.channelId === selectedChannelId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [usersById, selectedChannelId])

  if (status !== 'connected') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>{status === 'reconnecting' ? '重连中…' : '未连接'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Gateway: {gatewayStatus}</p>
            {connectError ? <p className="text-sm text-destructive">{connectError}</p> : null}
            <div className="flex gap-2">
              <Button onClick={() => (window.location.href = '/')}>返回连接页</Button>
              {status === 'reconnecting' ? (
                <Button variant="secondary" onClick={() => disconnect()}>
                  取消重连
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Mumble Web</h1>
          <p className="text-xs text-muted-foreground">
            WS RTT: {metrics.wsRttMs ?? '-'}ms · Server RTT: {metrics.serverRttMs ?? '-'}ms · Self: {selfUserId ?? '-'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              window.alert('设置面板：M3+ 将接入设备/降噪/VAD/码率等音频选项')
            }}
          >
            设置
          </Button>
          <Button variant="secondary" onClick={() => disconnect()}>
            断开
          </Button>
        </div>
      </header>

      {connectError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="truncate">{connectError}</span>
          <button className="text-xs underline" onClick={() => clearError()}>
            关闭
          </button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">延迟与统计</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">网络</p>
            <div className="text-xs text-muted-foreground">
              <div>WS RTT: {metrics.wsRttMs != null ? `${Math.round(metrics.wsRttMs)}ms` : '-'}</div>
              <div>Server RTT: {metrics.serverRttMs != null ? `${Math.round(metrics.serverRttMs)}ms` : '-'}</div>
              <div>
                WS Send Buffer:{' '}
                {metrics.wsBufferedAmountBytes != null ? `${Math.round(metrics.wsBufferedAmountBytes / 1024)}KB` : '-'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">语音（Gateway）</p>
            <div className="text-xs text-muted-foreground">
              <div>
                下行:{' '}
                {metrics.voiceDownlinkFps != null ? `${metrics.voiceDownlinkFps.toFixed(1)} fps` : '-'} ·{' '}
                {metrics.voiceDownlinkKbps != null ? `${metrics.voiceDownlinkKbps.toFixed(1)} kbps` : '-'} · 丢弃:{' '}
                {metrics.voiceDownlinkDroppedFps != null ? `${metrics.voiceDownlinkDroppedFps.toFixed(1)} fps` : '-'}
              </div>
              <div>
                上行: {metrics.voiceUplinkFps != null ? `${metrics.voiceUplinkFps.toFixed(1)} fps` : '-'} ·{' '}
                {metrics.voiceUplinkKbps != null ? `${metrics.voiceUplinkKbps.toFixed(1)} kbps` : '-'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">语音/音频（浏览器）</p>
            <div className="text-xs text-muted-foreground">
              <div>抖动估计: {metrics.voiceDownlinkJitterMs != null ? `${metrics.voiceDownlinkJitterMs}ms` : '-'}</div>
              <div>缺帧: {metrics.voiceDownlinkMissingFramesTotal ?? '-'}</div>
              <div>乱序: {metrics.voiceDownlinkOutOfOrderFramesTotal ?? '-'}</div>
              <div>
                播放缓冲:{' '}
                {playbackStats ? `${Math.round(playbackStats.totalQueuedMs)}ms (max ${Math.round(playbackStats.maxQueuedMs)}ms)` : '-'}
              </div>
              <div>活跃流: {playbackStats ? playbackStats.streams : '-'}</div>
              <div>
                Mic: {captureStats ? `${captureStats.rms.toFixed(4)} RMS` : '-'} {captureStats?.sending ? '(sending)' : ''}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">语音</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            variant={audioReady ? 'secondary' : 'default'}
            onClick={async () => {
              await voiceRef.current?.enableAudio()
              setAudioReady(Boolean(voiceRef.current?.audioReady))
            }}
          >
            {audioReady ? '音频已启用' : '启用音频'}
          </Button>

          <Button
            variant={micEnabled ? 'secondary' : 'default'}
            disabled={!audioReady || status !== 'connected' || !webCodecsAvailable}
            onClick={async () => {
              if (micEnabled) {
                voiceRef.current?.disableMic()
                setMicEnabled(false)
                return
              }
              try {
                await voiceRef.current?.enableMic()
                setMicEnabled(true)
              } catch (e) {
                window.alert(`无法启用麦克风：${String(e)}`)
              }
            }}
          >
            {micEnabled ? '关闭麦克风' : '开启麦克风'}
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">模式</span>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={voiceMode}
              onChange={(e) => {
                const next = e.target.value === 'ptt' ? 'ptt' : 'vad'
                setVoiceMode(next)
                voiceRef.current?.setMode(next)
              }}
              disabled={!micEnabled}
            >
              <option value="vad">VAD</option>
              <option value="ptt">PTT</option>
            </select>
          </div>

          {voiceMode === 'vad' ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">阈值</span>
              <input
                type="range"
                min={0.005}
                max={0.08}
                step={0.001}
                value={vadThreshold}
                disabled={!micEnabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVadThreshold(v)
                  voiceRef.current?.setVadThreshold(v)
                }}
              />
              <span className="w-14 text-right text-xs text-muted-foreground">{vadThreshold.toFixed(3)}</span>
            </div>
          ) : (
            <Button
              disabled={!micEnabled}
              onPointerDown={() => voiceRef.current?.setPttActive(true)}
              onPointerUp={() => voiceRef.current?.setPttActive(false)}
              onPointerLeave={() => voiceRef.current?.setPttActive(false)}
            >
              按住说话
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            当前实现：Opus 通过网关透传（TCP `UDPTunnel`）；编解码在浏览器侧（WebCodecs）。
          </p>
          {!webCodecsAvailable ? (
            <p className="text-xs text-destructive">当前浏览器不支持 WebCodecs Opus（无法语音）；请使用 Chrome/Edge 等支持 WebCodecs 的浏览器。</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid flex-1 gap-4 md:grid-cols-[280px_1fr_280px]">
        <Card className="min-h-[60vh]">
          <CardHeader>
            <CardTitle className="text-base">频道</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">Root: {root?.name ?? '-'}</p>
            <div className="max-h-[60vh] overflow-auto pr-1">
              <ul className="space-y-1">
                {channelTree.map(({ id, depth }) => {
                  const ch = channelsById[id]
                  if (!ch) return null
                  const selected = id === selectedChannelId
                  return (
                    <li key={id}>
                      <button
                        className={cn(
                          'flex w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
                          selected && 'bg-accent'
                        )}
                        style={{ paddingLeft: 8 + depth * 12 }}
                        onClick={() => selectChannel(id)}
                      >
                        {ch.name || '(unnamed)'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            <Button disabled={selectedChannelId == null} onClick={() => joinSelectedChannel()}>
              加入所选频道
            </Button>
          </CardContent>
        </Card>

        <Card className="min-h-[60vh]">
          <CardHeader>
            <CardTitle className="text-base">聊天</CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-3">
            <div className="flex-1 overflow-auto rounded-md border border-border p-3">
              <div className="space-y-2">
                {chat.map((m) => (
                  <div key={m.id} className="text-sm">
                    <span className="font-medium">
                      {usersById[m.senderId]?.name ?? (m.senderId === 0 ? 'System' : `#${m.senderId}`)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="whitespace-pre-wrap">{m.message}</span>
                  </div>
                ))}
              </div>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!message.trim()) return
                sendTextToSelectedChannel(message)
                setMessage('')
              }}
            >
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="输入消息…" />
              <Button type="submit" disabled={!message.trim()}>
                发送
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="min-h-[60vh]">
          <CardHeader>
            <CardTitle className="text-base">用户</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">当前频道用户：{usersInSelectedChannel.length}</p>
            <ul className="mt-2 space-y-1">
              {usersInSelectedChannel.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent">
                  <span className={cn(u.id === selfUserId && 'font-semibold')}>{u.name}</span>
                  <span className="text-xs text-muted-foreground">#{u.id}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
