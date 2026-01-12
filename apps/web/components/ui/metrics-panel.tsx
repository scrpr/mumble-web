'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './card'
import { LineChart } from './line-chart'
import { Button } from './button'
import { X, Activity, ArrowDown, ArrowUp, Wifi, Gauge, AlertTriangle } from 'lucide-react'
import { cn } from '../../src/ui/cn'

type Metrics = {
  wsRttMs?: number
  serverRttMs?: number
  wsBufferedAmountBytes?: number
  voiceDownlinkFramesTotal?: number
  voiceDownlinkBytesTotal?: number
  voiceDownlinkDroppedFramesTotal?: number
  voiceUplinkFramesTotal?: number
  voiceUplinkBytesTotal?: number
  voiceDownlinkFps?: number
  voiceDownlinkKbps?: number
  voiceDownlinkDroppedFps?: number
  voiceUplinkFps?: number
  voiceUplinkKbps?: number
  voiceDownlinkJitterMs?: number
  voiceDownlinkMissingFramesTotal?: number
  voiceDownlinkOutOfOrderFramesTotal?: number
}

type PlaybackStats = {
  totalQueuedMs: number
  maxQueuedMs: number
  streams: number
}

type CaptureStats = {
  rms: number
  sending: boolean
}

type MetricsPanelProps = {
  metrics: Metrics
  playbackStats: PlaybackStats | null
  captureStats: CaptureStats | null
  onClose: () => void
}

const MAX_HISTORY = 120

function useMetricsHistory(metrics: Metrics, playbackStats: PlaybackStats | null, captureStats: CaptureStats | null) {
  const [history, setHistory] = useState<{
    wsRtt: number[]
    serverRtt: number[]
    downlinkKbps: number[]
    uplinkKbps: number[]
    jitter: number[]
    buffer: number[]
    micLevel: number[]
  }>({
    wsRtt: [],
    serverRtt: [],
    downlinkKbps: [],
    uplinkKbps: [],
    jitter: [],
    buffer: [],
    micLevel: []
  })

  const lastUpdateRef = useRef(0)

  useEffect(() => {
    const now = Date.now()
    // 每 500ms 更新一次历史记录
    if (now - lastUpdateRef.current < 500) return
    lastUpdateRef.current = now

    setHistory(prev => ({
      wsRtt: [...prev.wsRtt, metrics.wsRttMs ?? 0].slice(-MAX_HISTORY),
      serverRtt: [...prev.serverRtt, metrics.serverRttMs ?? 0].slice(-MAX_HISTORY),
      downlinkKbps: [...prev.downlinkKbps, metrics.voiceDownlinkKbps ?? 0].slice(-MAX_HISTORY),
      uplinkKbps: [...prev.uplinkKbps, metrics.voiceUplinkKbps ?? 0].slice(-MAX_HISTORY),
      jitter: [...prev.jitter, metrics.voiceDownlinkJitterMs ?? 0].slice(-MAX_HISTORY),
      buffer: [...prev.buffer, playbackStats?.totalQueuedMs ?? 0].slice(-MAX_HISTORY),
      micLevel: [...prev.micLevel, (captureStats?.rms ?? 0) * 100].slice(-MAX_HISTORY)
    }))
  }, [metrics, playbackStats, captureStats])

  return history
}

function MetricCard({ label, value, unit, icon: Icon, status }: {
  label: string
  value: string | number
  unit?: string
  icon?: React.ComponentType<{ className?: string }>
  status?: 'good' | 'warn' | 'bad' | undefined
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border p-3 transition-colors",
      status === 'good' && "border-green-500/30 bg-green-500/5",
      status === 'warn' && "border-yellow-500/30 bg-yellow-500/5",
      status === 'bad' && "border-red-500/30 bg-red-500/5",
      !status && "border-border bg-card/50"
    )}>
      {Icon && (
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          status === 'good' && "bg-green-500/10 text-green-500",
          status === 'warn' && "bg-yellow-500/10 text-yellow-500",
          status === 'bad' && "bg-red-500/10 text-red-500",
          !status && "bg-muted text-muted-foreground"
        )}>
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-semibold">
          {value}{unit && <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>}
        </span>
      </div>
    </div>
  )
}

function getRttStatus(rtt: number | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (rtt == null) return undefined
  if (rtt < 50) return 'good'
  if (rtt < 150) return 'warn'
  return 'bad'
}

function getJitterStatus(jitter: number | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (jitter == null) return undefined
  if (jitter < 10) return 'good'
  if (jitter < 30) return 'warn'
  return 'bad'
}

export function MetricsPanel({ metrics, playbackStats, captureStats, onClose }: MetricsPanelProps) {
  const history = useMetricsHistory(metrics, playbackStats, captureStats)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b shrink-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            连接质量监控
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-4 overflow-y-auto space-y-6">
          {/* 延迟指标 */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3 flex items-center gap-2">
              <Wifi className="h-3 w-3" /> 网络延迟
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="WebSocket RTT"
                value={metrics.wsRttMs != null ? Math.round(metrics.wsRttMs) : '-'}
                unit="ms"
                icon={Gauge}
                status={getRttStatus(metrics.wsRttMs)}
              />
              <MetricCard
                label="Mumble Server RTT"
                value={metrics.serverRttMs != null ? Math.round(metrics.serverRttMs) : '-'}
                unit="ms"
                icon={Gauge}
                status={getRttStatus(metrics.serverRttMs)}
              />
              <MetricCard
                label="Jitter"
                value={metrics.voiceDownlinkJitterMs?.toFixed(1) ?? '-'}
                unit="ms"
                icon={Activity}
                status={getJitterStatus(metrics.voiceDownlinkJitterMs)}
              />
              <MetricCard
                label="WS Buffer"
                value={metrics.wsBufferedAmountBytes != null ? (metrics.wsBufferedAmountBytes / 1024).toFixed(1) : '-'}
                unit="KB"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.wsRtt}
                  label="WebSocket RTT"
                  unit="ms"
                  color="hsl(var(--primary))"
                  fillColor="hsl(var(--primary))"
                  height={80}
                  maxY={Math.max(200, ...history.wsRtt)}
                />
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.jitter}
                  label="Jitter"
                  unit="ms"
                  color="hsl(142, 76%, 36%)"
                  fillColor="hsl(142, 76%, 36%)"
                  height={80}
                  maxY={Math.max(50, ...history.jitter)}
                />
              </div>
            </div>
          </section>

          {/* 语音下行 */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3 flex items-center gap-2">
              <ArrowDown className="h-3 w-3" /> 语音下行（接收）
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="比特率"
                value={metrics.voiceDownlinkKbps?.toFixed(1) ?? '-'}
                unit="kbps"
              />
              <MetricCard
                label="帧率"
                value={metrics.voiceDownlinkFps?.toFixed(1) ?? '-'}
                unit="fps"
              />
              <MetricCard
                label="播放缓冲"
                value={playbackStats?.totalQueuedMs?.toFixed(0) ?? '-'}
                unit="ms"
              />
              <MetricCard
                label="活跃流"
                value={playbackStats?.streams ?? '-'}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="总帧数"
                value={metrics.voiceDownlinkFramesTotal?.toLocaleString() ?? '-'}
              />
              <MetricCard
                label="总字节"
                value={metrics.voiceDownlinkBytesTotal != null ? (metrics.voiceDownlinkBytesTotal / 1024).toFixed(1) : '-'}
                unit="KB"
              />
              <MetricCard
                label="丢帧"
                value={metrics.voiceDownlinkDroppedFramesTotal ?? '-'}
                icon={AlertTriangle}
                status={(metrics.voiceDownlinkDroppedFramesTotal ?? 0) > 0 ? 'warn' : 'good'}
              />
              <MetricCard
                label="乱序帧"
                value={metrics.voiceDownlinkOutOfOrderFramesTotal ?? '-'}
                status={(metrics.voiceDownlinkOutOfOrderFramesTotal ?? 0) > 10 ? 'warn' : undefined}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.downlinkKbps}
                  label="下行比特率"
                  unit="kbps"
                  color="hsl(221, 83%, 53%)"
                  fillColor="hsl(221, 83%, 53%)"
                  height={80}
                  minY={0}
                  maxY={Math.max(100, ...history.downlinkKbps)}
                />
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.buffer}
                  label="播放缓冲"
                  unit="ms"
                  color="hsl(262, 83%, 58%)"
                  fillColor="hsl(262, 83%, 58%)"
                  height={80}
                  minY={0}
                  maxY={Math.max(500, ...history.buffer)}
                />
              </div>
            </div>
          </section>

          {/* 语音上行 */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3 flex items-center gap-2">
              <ArrowUp className="h-3 w-3" /> 语音上行（发送）
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="比特率"
                value={metrics.voiceUplinkKbps?.toFixed(1) ?? '-'}
                unit="kbps"
              />
              <MetricCard
                label="帧率"
                value={metrics.voiceUplinkFps?.toFixed(1) ?? '-'}
                unit="fps"
              />
              <MetricCard
                label="麦克风音量"
                value={captureStats ? (captureStats.rms * 100).toFixed(1) : '-'}
                unit="%"
              />
              <MetricCard
                label="发送状态"
                value={captureStats?.sending ? '发送中' : '静音'}
                status={captureStats?.sending ? 'good' : undefined}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="总帧数"
                value={metrics.voiceUplinkFramesTotal?.toLocaleString() ?? '-'}
              />
              <MetricCard
                label="总字节"
                value={metrics.voiceUplinkBytesTotal != null ? (metrics.voiceUplinkBytesTotal / 1024).toFixed(1) : '-'}
                unit="KB"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.uplinkKbps}
                  label="上行比特率"
                  unit="kbps"
                  color="hsl(25, 95%, 53%)"
                  fillColor="hsl(25, 95%, 53%)"
                  height={80}
                  minY={0}
                  maxY={Math.max(100, ...history.uplinkKbps)}
                />
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <LineChart
                  data={history.micLevel}
                  label="麦克风电平"
                  unit="%"
                  color="hsl(350, 89%, 60%)"
                  fillColor="hsl(350, 89%, 60%)"
                  height={80}
                  minY={0}
                  maxY={100}
                />
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
