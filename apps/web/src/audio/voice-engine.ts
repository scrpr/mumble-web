'use client'

type VoiceEngineConfig = {
  onMicPcm: (pcm: Float32Array, sampleRate: number) => void
  onMicEnd: () => void
  onPlaybackStats?: (stats: { totalQueuedMs: number; maxQueuedMs: number; streams: number }) => void
  onCaptureStats?: (stats: { rms: number; sending: boolean }) => void
}

export type VoicePcmFrame = {
  userId: number
  channels: number
  sampleRate: number
  pcm: Float32Array
}

export class VoiceEngine {
  private _config: VoiceEngineConfig

  private _audioContext: AudioContext | null = null
  private _playbackNode: AudioWorkletNode | null = null
  private _playbackGain: GainNode | null = null
  private _captureNode: AudioWorkletNode | null = null
  private _captureGain: GainNode | null = null
  private _muted = false

  private _micStream: MediaStream | null = null
  private _micSource: MediaStreamAudioSourceNode | null = null

  private _micEnabled = false
  private _mode: 'vad' | 'ptt' = 'vad'
  private _pttActive = false
  private _vadThreshold = 0.02
  private _vadHoldTimeMs = 200

  constructor(config: VoiceEngineConfig) {
    this._config = config
  }

  get audioReady() {
    return Boolean(this._audioContext && this._playbackNode)
  }

  get micEnabled() {
    return this._micEnabled
  }

  get muted() {
    return this._muted
  }

  setMuted(muted: boolean) {
    this._muted = muted
    if (this._playbackGain) {
      this._playbackGain.gain.value = muted ? 0 : 1
    }
  }

  async enableAudio(): Promise<void> {
    if (this._audioContext && this._playbackNode) {
      await this._audioContext.resume()
      return
    }

    const ctx = new AudioContext({ sampleRate: 48000 })
    await ctx.audioWorklet.addModule('/audio/playback-worklet.js')
    await ctx.audioWorklet.addModule('/audio/capture-worklet.js')

    const playback = new AudioWorkletNode(ctx, 'mumble-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })

    const playbackGain = ctx.createGain()
    playbackGain.gain.value = this._muted ? 0 : 1
    playback.connect(playbackGain).connect(ctx.destination)

    playback.port.onmessage = (event) => {
      const msg = event.data
      if (!msg || msg.type !== 'stats') return
      this._config.onPlaybackStats?.({
        totalQueuedMs: typeof msg.totalQueuedMs === 'number' ? msg.totalQueuedMs : 0,
        maxQueuedMs: typeof msg.maxQueuedMs === 'number' ? msg.maxQueuedMs : 0,
        streams: typeof msg.streams === 'number' ? msg.streams : 0
      })
    }

    this._audioContext = ctx
    this._playbackNode = playback
    this._playbackGain = playbackGain

    if (ctx.sampleRate !== 48000) {
      // Keep working, but current implementation assumes 48kHz for both playback and uplink.
      // Resampling will be added later.
      // eslint-disable-next-line no-console
      console.warn(`[voice] AudioContext sampleRate is ${ctx.sampleRate} (expected 48000)`)
    }

    await ctx.resume()
  }

  pushRemotePcm(frame: VoicePcmFrame): void {
    const ctx = this._audioContext
    const playback = this._playbackNode
    if (!ctx || !playback) return

    // Current pipeline expects 48kHz PCM. Resampling can be added when needed.
    if (frame.sampleRate !== 48000) return

    const pcmCopy = new Float32Array(frame.pcm.length)
    pcmCopy.set(frame.pcm)

    playback.port.postMessage(
      { type: 'pcm', userId: frame.userId, channels: frame.channels, pcm: pcmCopy.buffer },
      [pcmCopy.buffer]
    )
  }

  setMode(mode: 'vad' | 'ptt') {
    this._mode = mode
    this._postCaptureConfig()
  }

  setVadThreshold(value: number) {
    this._vadThreshold = value
    this._postCaptureConfig()
  }

  setVadHoldTime(ms: number) {
    this._vadHoldTimeMs = ms
    this._postCaptureConfig()
  }

  setPttActive(active: boolean) {
    this._pttActive = active
    this._postCaptureConfig()
  }

  private _postCaptureConfig() {
    if (!this._captureNode) return
    const hangoverFrames = Math.round(this._vadHoldTimeMs / 20)
    this._captureNode.port.postMessage({
      type: 'config',
      enabled: this._micEnabled,
      mode: this._mode,
      pttActive: this._pttActive,
      vadThreshold: this._vadThreshold,
      frameSize: 960,
      hangoverFrames
    })
  }

  async enableMic(options?: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; deviceId?: string }): Promise<void> {
    if (this._micEnabled) return
    await this.enableAudio()

    const ctx = this._audioContext
    if (!ctx) return

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: options?.echoCancellation ?? true,
      noiseSuppression: options?.noiseSuppression ?? true,
      autoGainControl: options?.autoGainControl ?? true,
      channelCount: 1
    }
    if (options?.deviceId) {
      audioConstraints.deviceId = { exact: options.deviceId }
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

    const source = ctx.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(ctx, 'mumble-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    })

    // Keep the node running while not producing audible output.
    const gain = ctx.createGain()
    gain.gain.value = 0

    source.connect(capture)
    capture.connect(gain).connect(ctx.destination)

    capture.port.onmessage = (event) => {
      const msg = event.data
      if (!msg || typeof msg.type !== 'string') return
      if (msg.type === 'pcm' && msg.pcm instanceof ArrayBuffer) {
        const pcm = new Float32Array(msg.pcm)
        this._config.onMicPcm(pcm, ctx.sampleRate)
      } else if (msg.type === 'end') {
        this._config.onMicEnd()
      } else if (msg.type === 'stats') {
        this._config.onCaptureStats?.({
          rms: typeof msg.rms === 'number' ? msg.rms : 0,
          sending: Boolean(msg.sending)
        })
      }
    }

    this._micStream = stream
    this._micSource = source
    this._captureNode = capture
    this._captureGain = gain
    this._micEnabled = true
    this._postCaptureConfig()
  }

  disableMic(): void {
    if (!this._micEnabled) return

    this._micEnabled = false
    this._postCaptureConfig()
    this._config.onMicEnd()

    if (this._micSource) {
      try {
        this._micSource.disconnect()
      } catch {}
      this._micSource = null
    }

    if (this._captureNode) {
      try {
        this._captureNode.disconnect()
      } catch {}
      this._captureNode = null
    }

    if (this._captureGain) {
      try {
        this._captureGain.disconnect()
      } catch {}
      this._captureGain = null
    }

    if (this._micStream) {
      for (const t of this._micStream.getTracks()) {
        try {
          t.stop()
        } catch {}
      }
      this._micStream = null
    }
  }

  async switchDevice(options: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; deviceId?: string }): Promise<void> {
    if (!this._micEnabled) return
    this.disableMic()
    await this.enableMic(options)
  }
}
