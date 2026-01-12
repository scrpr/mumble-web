'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useGatewayStore } from '../../src/state/gateway-store'
import { ArrowLeft, Mic, Shield, Wifi } from 'lucide-react'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export default function SettingsPage() {
  const {
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
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" title="Back">
              <Link href="/app">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-lg font-semibold">Settings</h1>
          </div>
          <Button asChild variant="secondary">
            <Link href="/app">Back to App</Link>
          </Button>
        </div>

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
    </main>
  )
}

