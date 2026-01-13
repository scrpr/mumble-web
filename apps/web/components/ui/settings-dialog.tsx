'use client'

import { Card, CardContent, CardHeader, CardTitle } from './card'
import { Input } from './input'
import { useGatewayStore } from '../../src/state/gateway-store'
import { Mic, Shield, Wifi, AudioWaveform } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    vadThreshold,
    setVadThreshold,
    vadHoldTimeMs,
    setVadHoldTimeMs,
    opusBitrate,
    setOpusBitrate,
    uplinkCongestionControlEnabled,
    setUplinkCongestionControlEnabled,
    uplinkMaxBufferedAmountBytes,
    setUplinkMaxBufferedAmountBytes,
    micEchoCancellation,
    setMicEchoCancellation,
    micNoiseSuppression,
    setMicNoiseSuppression,
    micAutoGainControl,
    setMicAutoGainControl,
    rnnoiseEnabled,
    setRnnoiseEnabled,
  } = useGatewayStore()

  const uplinkMaxBufferedKb = Math.round(uplinkMaxBufferedAmountBytes / 1024)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AudioWaveform className="h-4 w-4 text-primary" />
                Voice Activation (VAD)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">灵敏度</div>
                    <div className="text-xs text-muted-foreground">值越小越灵敏，环境噪声大时可调高。</div>
                  </div>
                  <div className="text-sm font-mono">{(vadThreshold * 100).toFixed(1)}%</div>
                </div>
                <input
                  type="range"
                  min={0.005}
                  max={0.08}
                  step={0.001}
                  value={vadThreshold}
                  onChange={(e) => setVadThreshold(clampNumber(Number(e.target.value), 0.005, 0.08))}
                  className="w-full h-2 accent-primary bg-accent rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">保持时间</div>
                    <div className="text-xs text-muted-foreground">声音消失后继续发送的时长，避免词语间断。</div>
                  </div>
                  <div className="text-sm font-mono">{vadHoldTimeMs} ms</div>
                </div>
                <input
                  type="range"
                  min={100}
                  max={1000}
                  step={50}
                  value={vadHoldTimeMs}
                  onChange={(e) => setVadHoldTimeMs(clampNumber(Number(e.target.value), 100, 1000))}
                  className="w-full h-2 accent-primary bg-accent rounded-full appearance-none cursor-pointer"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wifi className="h-4 w-4 text-primary" />
                Uplink (Weak Network)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={uplinkCongestionControlEnabled}
                  onChange={(e) => setUplinkCongestionControlEnabled(e.target.checked)}
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium">Enable uplink congestion control</div>
                  <div className="text-xs text-muted-foreground">
                    Keeps voice realtime by dropping queued frames when the WebSocket send buffer is backed up.
                  </div>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Max WS send buffer</div>
                  <div className="text-xs text-muted-foreground">Drop/hold voice frames when buffered exceeds this threshold.</div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-24"
                    inputMode="numeric"
                    value={uplinkMaxBufferedKb}
                    onChange={(e) => {
                      const kb = clampNumber(Number(e.target.value), 32, 4096)
                      setUplinkMaxBufferedAmountBytes(kb * 1024)
                    }}
                  />
                  <span className="text-xs text-muted-foreground">KB</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-primary" />
                Audio Quality
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Opus bitrate</div>
                    <div className="text-xs text-muted-foreground">Lower bitrate can help on unstable uplinks.</div>
                  </div>
                  <div className="text-sm font-mono">{Math.round(opusBitrate / 1000)} kbps</div>
                </div>
                <input
                  type="range"
                  min={12000}
                  max={48000}
                  step={1000}
                  value={opusBitrate}
                  onChange={(e) => setOpusBitrate(clampNumber(Number(e.target.value), 12000, 48000))}
                  className="w-full h-2 accent-primary bg-accent rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="h-px bg-border" />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Mic className="h-4 w-4 text-primary" />
                  Microphone Processing
                </div>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={rnnoiseEnabled}
                    onChange={(e) => setRnnoiseEnabled(e.target.checked)}
                  />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">RNNoise (WASM) noise suppression</div>
                    <div className="text-xs text-muted-foreground">
                      Improves noisy/cheap microphones, but adds CPU usage.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={micNoiseSuppression}
                    onChange={(e) => setMicNoiseSuppression(e.target.checked)}
                  />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Browser noise suppression</div>
                    <div className="text-xs text-muted-foreground">Uses built-in processing from `getUserMedia()`.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={micEchoCancellation}
                    onChange={(e) => setMicEchoCancellation(e.target.checked)}
                  />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Echo cancellation</div>
                    <div className="text-xs text-muted-foreground">Recommended when using speakers (not headphones).</div>
                  </div>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={micAutoGainControl}
                    onChange={(e) => setMicAutoGainControl(e.target.checked)}
                  />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Auto gain control (AGC)</div>
                    <div className="text-xs text-muted-foreground">May amplify background noise on low-quality microphones.</div>
                  </div>
                </label>
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Changes apply next time you toggle the microphone on.
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
