'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { useGatewayStore } from '../../src/state/gateway-store'
import { cn } from '../../src/ui/cn'
import { VoiceEngine } from '../../src/audio/voice-engine'
import { canUseWebCodecsOpus, createWebCodecsOpusDecoder, createWebCodecsOpusEncoder } from '../../src/audio/webcodecs-opus'
import { Rnnoise, type DenoiseState } from '@shiguredo/rnnoise-wasm'
import { Mic, MicOff, Video, Settings, LogOut, MessageSquare, Users, Hash, Volume2, VolumeX, Activity, Send, BarChart3 } from 'lucide-react'
import { MetricsPanel } from '../../components/ui/metrics-panel'
import { SettingsDialog } from '../../components/ui/settings-dialog'

export default function AppPage() {
  const {
    gatewayStatus,
    status,
    channelsById,
    usersById,
    speakingByUserId,
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
    sendMicEnd,
    voiceMode,
    vadThreshold,
    vadHoldTimeMs,
    opusBitrate,
    micEchoCancellation,
    micNoiseSuppression,
    micAutoGainControl,
    rnnoiseEnabled,
    setVoiceMode,
    selectedInputDeviceId
  } = useGatewayStore()

  const webCodecsAvailable = canUseWebCodecsOpus()

  const [message, setMessage] = useState('')
  const [muted, setMuted] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [showMetricsPanel, setShowMetricsPanel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [playbackStats, setPlaybackStats] = useState<{ totalQueuedMs: number; maxQueuedMs: number; streams: number } | null>(null)
  const [captureStats, setCaptureStats] = useState<{ rms: number; sending: boolean } | null>(null)
  const voiceRef = useRef<VoiceEngine | null>(null)
  const rnnoiseRef = useRef<{ state: DenoiseState; frameSize: number; buf: Float32Array } | null>(null)

  // Initialize and clean up voice engine
  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!rnnoiseEnabled) {
      rnnoiseRef.current?.state.destroy()
      rnnoiseRef.current = null
      return
    }

    let cancelled = false

      ; (async () => {
        try {
          const rnnoise = await Rnnoise.load()
          if (cancelled) return
          const state = rnnoise.createDenoiseState()
          if (cancelled) {
            state.destroy()
            return
          }
          rnnoiseRef.current?.state.destroy()
          rnnoiseRef.current = { state, frameSize: rnnoise.frameSize, buf: new Float32Array(rnnoise.frameSize) }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[voice] failed to init RNNoise: ${String(e)}`)
        }
      })()

    return () => {
      cancelled = true
      rnnoiseRef.current?.state.destroy()
      rnnoiseRef.current = null
    }
  }, [rnnoiseEnabled])

  useEffect(() => {
    const decoders = new Map<number, ReturnType<typeof createWebCodecsOpusDecoder>>()

    let encoder: ReturnType<typeof createWebCodecsOpusEncoder> | null = null
    if (canUseWebCodecsOpus()) {
      try {
        encoder = createWebCodecsOpusEncoder({
          sampleRate: 48000,
          channels: 1,
          bitrate: opusBitrate,
          onOpus: (opus) => sendMicOpus(opus, { target: 0 })
        })
      } catch (e) {
        console.warn(`[voice] failed to init WebCodecs Opus encoder: ${String(e)}`)
      }
    }

    const engine = new VoiceEngine({
      onMicPcm: (pcm, sampleRate) => {
        if (sampleRate !== 48000) return

        const rn = rnnoiseRef.current
        if (rn) {
          try {
            const scale = 32768
            const invScale = 1 / scale
            const { state, frameSize, buf } = rn

            for (let offset = 0; offset + frameSize <= pcm.length; offset += frameSize) {
              buf.set(pcm.subarray(offset, offset + frameSize))

              // RNNoise assumes 16-bit PCM amplitude.
              for (let i = 0; i < frameSize; i++) {
                const v = (buf[i] ?? 0) * scale
                buf[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
              }

              state.processFrame(buf)

              for (let i = 0; i < frameSize; i++) {
                const v = (buf[i] ?? 0) * invScale
                pcm[offset + i] = v > 1 ? 1 : v < -1 ? -1 : v
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[voice] rnnoise process failed: ${String(e)}`)
          }
        }

        encoder?.encode(pcm)
      },
      onMicEnd: () => {
        if (!encoder) {
          sendMicEnd()
          return
        }
        encoder
          .flush()
          .catch(() => { })
          .finally(() => sendMicEnd())
      },
      onPlaybackStats: (s) => setPlaybackStats(s),
      onCaptureStats: (s) => setCaptureStats(s)
    })
    voiceRef.current = engine

    // Sync initial settings
    engine.setMode(voiceMode)
    engine.setVadThreshold(vadThreshold)
    engine.setVadHoldTime(vadHoldTimeMs)

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
  }, [sendMicEnd, sendMicOpus, setVoiceSink, opusBitrate])

  useEffect(() => {
    if (status === 'connected') {
      voiceRef.current?.enableAudio()
    } else {
      voiceRef.current?.disableMic()
      setMicEnabled(false)
    }
  }, [status])

  // Update voice engine when settings change
  useEffect(() => {
    voiceRef.current?.setMode(voiceMode)
  }, [voiceMode])

  useEffect(() => {
    voiceRef.current?.setVadThreshold(vadThreshold)
  }, [vadThreshold])

  useEffect(() => {
    voiceRef.current?.setVadHoldTime(vadHoldTimeMs)
  }, [vadHoldTimeMs])

  useEffect(() => {
    if (!micEnabled) return
    const options: Parameters<VoiceEngine['switchDevice']>[0] = {
      echoCancellation: micEchoCancellation,
      noiseSuppression: micNoiseSuppression,
      autoGainControl: micAutoGainControl
    }
    // With `exactOptionalPropertyTypes`, omit optional keys instead of passing `undefined`.
    if (selectedInputDeviceId != null) options.deviceId = selectedInputDeviceId

    voiceRef.current?.switchDevice(options).catch((e) => {
      console.warn(`[voice] failed to switch device: ${e}`)
    })
  }, [micEnabled, micEchoCancellation, micNoiseSuppression, micAutoGainControl, selectedInputDeviceId])

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

  // Scroll chat to bottom on new message
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  if (status !== 'connected') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Activity className="h-5 w-5" />
              {status === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Gateway Status: <span className="font-mono text-foreground">{gatewayStatus}</span></p>
            {connectError ? <p className="text-sm rounded-md bg-destructive/10 p-2 text-destructive">{connectError}</p> : null}
            <div className="flex gap-2">
              <Button onClick={() => (window.location.href = '/')}>Back to Login</Button>
              {status === 'reconnecting' ? (
                <Button variant="secondary" onClick={() => disconnect()}>
                  Cancel Reconnect
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Hash className="h-4 w-4 text-primary" />
          </div>
          <h1 className="font-semibold text-sm">Mumble Web</h1>
          <div className="mx-2 h-4 w-[1px] bg-border" />
          <p
            className="text-xs text-muted-foreground flex items-center gap-3 cursor-pointer hover:text-foreground transition-colors"
            onClick={() => setShowMetricsPanel(true)}
            title="点击查看详细指标"
          >
            <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> {metrics.wsRttMs != null ? Math.round(metrics.wsRttMs) : '-'}ms</span>
            <span className="hidden sm:inline">Server: {metrics.serverRttMs != null ? Math.round(metrics.serverRttMs) : '-'}ms</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMetricsPanel(true)}
            title="Connection Metrics"
            className="text-muted-foreground hover:text-foreground"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Settings" onClick={() => setShowSettings(true)} className="text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => disconnect()} title="Disconnect">
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Channel Tree */}
        <aside className="hidden w-64 flex-col border-r border-border bg-card/30 md:flex">
          <div className="flex h-10 items-center border-b border-border px-4">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Channels</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-0.5">
              <div className="px-2 py-1.5 text-xs font-semibold text-primary/80 truncate">
                {root?.name || 'Root'}
              </div>
              {channelTree.map(({ id, depth }) => {
                const ch = channelsById[id]
                if (!ch) return null
                const selected = id === selectedChannelId
                const hasUsers = Object.values(usersById).some(u => u.channelId === id)

                return (
                  <button
                    key={id}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      selected ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                    style={{ paddingLeft: 8 + depth * 12 }}
                    onClick={() => selectChannel(id)}
                  >
                    <Volume2 className={cn("h-3.5 w-3.5 shrink-0", hasUsers ? "opacity-100" : "opacity-50")} />
                    <span className="truncate">{ch.name || '(unnamed)'}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="border-t border-border p-3">
            <Button
              className="w-full"
              size="sm"
              disabled={selectedChannelId == null}
              onClick={() => joinSelectedChannel()}
            >
              Join Channel
            </Button>
          </div>
        </aside>

        {/* Middle: Chat */}
        <main className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
            <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Chat</span>
            {selectedChannelId != null && channelsById[selectedChannelId] && (
              <span className="ml-2 text-xs text-muted-foreground">in {channelsById[selectedChannelId].name}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chat.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground opacity-50">
                <MessageSquare className="mb-2 h-8 w-8" />
                <p className="text-sm">No messages yet</p>
              </div>
            ) : (
              chat.map((m) => {
                const isSystem = m.senderId === 0
                const isMe = m.senderId === selfUserId
                const user = usersById[m.senderId]
                return (
                  <div key={m.id} className={cn("flex flex-col gap-1 text-sm animate-in slide-in-from-left-2", isSystem && "items-center")}>
                    {!isSystem && (
                      <div className="flex items-baseline gap-2">
                        <span className={cn("font-semibold text-xs", isMe ? "text-primary" : "text-foreground")}>
                          {user?.name || (isMe ? 'Me' : `#${m.senderId}`)}
                        </span>
                        <span className="text-[10px] text-muted-foreground opacity-50">
                          {new Date(m.timestampMs).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    <div className={cn(
                      "rounded-lg px-3 py-2 max-w-[85%]",
                      isSystem ? "bg-muted text-xs text-muted-foreground" :
                        isMe ? "bg-primary text-primary-foreground self-end" : "bg-accent/50 text-foreground self-start"
                    )}>
                      {m.message}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 pt-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!message.trim()) return
                sendTextToSelectedChannel(message)
                setMessage('')
              }}
            >
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={selectedChannelId ? `Message ${channelsById[selectedChannelId]?.name}...` : "Send a message..."}
                className="flex-1"
              />
              <Button type="submit" size="icon" disabled={!message.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </main>

        {/* Right: User List */}
        <aside className="hidden w-64 flex-col border-l border-border bg-card/30 lg:flex">
          <div className="flex h-10 items-center justify-between border-b border-border px-4">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Users</span>
            <span className="text-xs text-muted-foreground">{usersInSelectedChannel.length} online</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {usersInSelectedChannel.map(u => {
                const isSelf = u.id === selfUserId
                const isSpeaking = speakingByUserId[u.id]
                return (
                  <li
                    key={u.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all",
                      isSpeaking ? "bg-green-500/10 text-green-500 shadow-sm ring-1 ring-green-500/20" : "hover:bg-accent text-foreground"
                    )}
                  >
                    <div className={cn(
                      "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/50 text-xs font-medium uppercase",
                      isSpeaking && "bg-green-500 text-white animate-pulse"
                    )}>
                      {u.name.slice(0, 2)}
                      {isSpeaking && <span className="absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background" />}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className={cn("truncate font-medium", isSelf && "text-primary")}>{u.name} {isSelf && '(You)'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>
      </div>

      {/* Bottom Bar: Voice Controls */}
      <footer className="shrink-0 border-t border-border bg-card p-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          {/* Left: Audio Toggle */}
          <div className="flex items-center gap-3">
            <Button
              variant={muted ? "destructive" : "secondary"}
              size="sm"
              className="w-32 transition-all"
              onClick={() => {
                const newMuted = !muted
                setMuted(newMuted)
                voiceRef.current?.setMuted(newMuted)
              }}
            >
              {muted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}
              {muted ? 'Muted' : 'Unmuted'}
            </Button>

            <div className="h-8 w-[1px] bg-border" />

            <Button
              variant={micEnabled ? (captureStats?.sending ? "destructive" : "secondary") : "outline"}
              size="icon"
              disabled={status !== 'connected' || !webCodecsAvailable}
              className={cn("rounded-full h-10 w-10", micEnabled && captureStats?.sending && "animate-pulse bg-red-500/20 text-red-500 hover:bg-red-500/30 border-red-500/50")}
              onClick={async () => {
                if (micEnabled) {
                  voiceRef.current?.disableMic()
                  setMicEnabled(false)
                } else {
                  try {
                    const options: Parameters<VoiceEngine['enableMic']>[0] = {
                      echoCancellation: micEchoCancellation,
                      noiseSuppression: micNoiseSuppression,
                      autoGainControl: micAutoGainControl
                    }
                    // With `exactOptionalPropertyTypes`, omit optional keys instead of passing `undefined`.
                    if (selectedInputDeviceId != null) options.deviceId = selectedInputDeviceId

                    await voiceRef.current?.enableMic(options)
                    setMicEnabled(true)
                  } catch (e) {
                    alert(`Failed to access microphone: ${e}`)
                  }
                }
              }}
            >
              {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>

            {micEnabled && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground w-8">Mode</span>
                  <div className="flex rounded-md border border-input p-0.5">
                    <button
                      onClick={() => setVoiceMode('vad')}
                      className={cn("px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors", voiceMode === 'vad' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                    >
                      VAD
                    </button>
                    <button
                      onClick={() => setVoiceMode('ptt')}
                      className={cn("px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors", voiceMode === 'ptt' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                    >
                      PTT
                    </button>
                  </div>
                </div>

                {voiceMode === 'ptt' && (
                  <Button
                    size="sm"
                    className="h-6 text-xs w-full"
                    onPointerDown={() => voiceRef.current?.setPttActive(true)}
                    onPointerUp={() => voiceRef.current?.setPttActive(false)}
                    onPointerLeave={() => voiceRef.current?.setPttActive(false)}
                  >
                    Hold to Talk
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Right: Metrics */}
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex flex-col items-end">
              <span>Buffer: {playbackStats ? `${Math.round(playbackStats.totalQueuedMs)}ms` : '-'}</span>
              <span className="text-[10px] opacity-70">Jitter: {metrics.voiceDownlinkJitterMs ?? 0}ms</span>
            </div>
            <div className="h-8 w-[1px] bg-border" />
            <div className="flex flex-col items-end">
              <span>Mic: {captureStats ? `${(captureStats.rms * 100).toFixed(1)}%` : '-'}</span>
              <span className="text-[10px] opacity-70">{captureStats?.sending ? 'Sending' : 'Silent'}</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Metrics Panel Modal */}
      <MetricsPanel
        metrics={metrics}
        playbackStats={playbackStats}
        captureStats={captureStats}
        open={showMetricsPanel}
        onOpenChange={setShowMetricsPanel}
      />

      {/* Settings Modal */}
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
      />
    </div>
  )
}
