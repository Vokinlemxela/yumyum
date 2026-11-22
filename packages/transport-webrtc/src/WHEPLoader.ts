import type { IStreamLoader, LoaderDeps, LoaderKind, QualityLevel, QualitySource } from '@yumyum-player/core';
import type { Logger } from '@yumyum-player/core';

// ─── Types ──────────────────────────────────────────────────────────

/** WHEP connection state exposed for diagnostics. */
export type WHEPConnectionState = 'new' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

/** Options for fine-tuning the WHEP session. */
export interface WHEPLoaderOptions {
  /**
   * @deprecated Reconnections are now unbounded; this option is ignored.
   */
  maxReconnectAttempts?: number;

  /**
   * WHEP endpoint connection timeout in milliseconds. Default: 10 000.
   */
  connectTimeoutMs?: number;

  /**
   * Additional headers sent with every WHEP HTTP request (POST offer, DELETE
   * teardown). Useful for bearer tokens or CDN auth.
   */
  extraHeaders?: Record<string, string>;

  /**
   * RTCConfiguration override (STUN/TURN servers, ICE policy, etc.).
   * Default: `{ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }`.
   */
  rtcConfig?: RTCConfiguration;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Detect browser support for Encoded Transform (insertable streams).
 * Returns `'script-transform'` (Chrome 110+), `'encoded-streams'` (Chrome 86–109),
 * or `null` if unsupported.
 */
export function detectEncodedTransformSupport(): 'script-transform' | 'encoded-streams' | null {
  if (typeof RTCRtpScriptTransform !== 'undefined') {
    return 'script-transform';
  }
  // Legacy: createEncodedStreams on RTCRtpReceiver
  if (typeof RTCRtpReceiver !== 'undefined' && 'createEncodedStreams' in RTCRtpReceiver.prototype) {
    return 'encoded-streams';
  }
  return null;
}

/**
 * Convert a `whep://` or `whep+https://` URL to the corresponding HTTP(S) URL
 * used for the actual WHEP POST/DELETE requests.
 *
 * - `whep://host/path`       → `http://host/path`
 * - `whep+https://host/path` → `https://host/path`
 */
export function whepToHttpUrl(whepUrl: string): string {
  if (whepUrl.startsWith('whep+https://')) {
    return whepUrl.replace('whep+https://', 'https://');
  }
  if (whepUrl.startsWith('whep://')) {
    return whepUrl.replace('whep://', 'http://');
  }
  // Already an HTTP(S) URL — pass through
  return whepUrl;
}

/**
 * Determine whether an RTP-depayloaded encoded frame is a keyframe from
 * the `RTCEncodedVideoFrame.type` field. The WebRTC spec uses `'key'` for
 * keyframes and `'delta'` (or `'empty'`) for everything else.
 */
function isKeyFrame(frameType: string): boolean {
  return frameType === 'key';
}

// ─── WHEPLoader ─────────────────────────────────────────────────────

/**
 * Low-latency WebRTC/WHEP loader: performs a WHEP handshake (SDP offer/answer
 * via HTTP POST), establishes an `RTCPeerConnection`, and feeds encoded video
 * frames directly into the player's decode pipeline via `onMockPacket`.
 *
 * Audio is handled natively through `MediaStream → AudioContext` since the
 * player's PCM pipeline doesn't need WebCodecs processing for audio.
 *
 * Registered for `whep://` and `whep+https://` by the `transportWebrtc()` plugin.
 */
export class WHEPLoader implements IStreamLoader, QualitySource {
  /** Live WHEP is push-driven: it streams continuously once connected. */
  public readonly kind: LoaderKind = 'push';
  public readonly quality: QualitySource = this;

  private qualityLevels: QualityLevel[] = [];
  private activeQualityId = 'main';

  // ── PeerConnection state ──
  private pc: RTCPeerConnection | null = null;
  private sessionUrl: string | null = null;
  private connectionState: WHEPConnectionState = 'new';
  private sourceUrl = '';

  // ── Reconnect state ──
  private reconnectAttempts = 0;
  private readonly connectTimeoutMs: number;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionEstablishTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectedTimeout: ReturnType<typeof setTimeout> | null = null;
  private isIntentionallyDisconnected = false;

  private lastBytesReceived = 0;
  private lastTimestamp = 0;
  private smoothedThroughputKbps = 0;
  private throughputSamplesCount = 0;
  private alpha = 0.15;
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  // ── Config ──
  private readonly extraHeaders: Record<string, string>;
  private readonly rtcConfig: RTCConfiguration;

  // ── Deps ──
  private onMockPacket: LoaderDeps['onMockPacket'];
  private onError: LoaderDeps['onError'];
  private logger: Logger;

  // ── Audio ──
  private audioContext: AudioContext | null = null;
  private audioSourceNode: MediaStreamAudioSourceNode | null = null;

  constructor(deps: LoaderDeps, logger: Logger, options: WHEPLoaderOptions = {}) {
    this.onMockPacket = deps.onMockPacket;
    this.onError = deps.onError;
    this.logger = logger;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.extraHeaders = options.extraHeaders ?? {};
    this.rtcConfig = options.rtcConfig ?? {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };
  }

  // ─── IStreamLoader ──────────────────────────────────────────────────

  public async load(url: string): Promise<void> {
    // 0. Feature detection
    const transformSupport = detectEncodedTransformSupport();
    if (!transformSupport) {
      const err = new Error(
        'Browser does not support Encoded Transform (insertable streams). ' +
        'WebRTC/WHEP transport requires Chrome/Edge 86+ or a compatible browser.'
      );
      this.onError?.(err);
      throw err;
    }

    this.qualityLevels = this.getStreamLevels(url);
    const activeLevel = this.qualityLevels.find(l => l.id === this.activeQualityId) || this.qualityLevels[0];
    this.activeQualityId = activeLevel.id;
    this.sourceUrl = activeLevel.url;
    this.isIntentionallyDisconnected = false;
    this.connectionState = 'connecting';

    await this.connect(activeLevel.url, transformSupport);
  }

  /** Live stream pushes data on connect; there is nothing to start on demand. */
  public start(isBackpressured: () => boolean): void {}

  /** Pausing keeps the connection open so the live edge stays current. */
  public stop(): void {}

  /** Seeking is not supported on a live stream. */
  public seek(timeSeconds: number): boolean {
    return false;
  }

  public getDuration(): number {
    return Infinity;
  }

  public destroy(): void {
    this.disconnect();
    this.onMockPacket = null;
    this.onError = null;
  }

  /** Current WHEP connection state for diagnostics. */
  public getConnectionState(): WHEPConnectionState {
    return this.connectionState;
  }

  // ─── WHEP Handshake ─────────────────────────────────────────────────

  private async connect(
    url: string,
    transformSupport: 'script-transform' | 'encoded-streams',
    isReconnect = false,
  ): Promise<void> {
    this.isIntentionallyDisconnected = false;
    if (isReconnect) {
      this.connectionState = 'reconnecting';
    }

    // Tear down previous connection but keep reconnect counter
    this.closePeerConnection(/* keepAttempts */ isReconnect);

    const httpUrl = whepToHttpUrl(url);

    // 1. Create RTCPeerConnection with encoded insertable streams
    const pc = new RTCPeerConnection({
      ...this.rtcConfig,
      // @ts-expect-error – non-standard Chrome property for legacy encoded streams
      encodedInsertableStreams: transformSupport === 'encoded-streams',
    });
    this.pc = pc;

    // 2. Add receive-only transceivers
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // 3. Wire ICE state monitoring
    pc.oniceconnectionstatechange = () => {
      if (pc !== this.pc) return;
      this.logger.debug(`ICE state: ${pc.iceConnectionState}`);

      if (pc.iceConnectionState !== 'disconnected') {
        if (this.disconnectedTimeout) {
          clearTimeout(this.disconnectedTimeout);
          this.disconnectedTimeout = null;
        }
      }
      if (pc.iceConnectionState !== 'connected') {
        if (this.connectionEstablishTimeout) {
          clearTimeout(this.connectionEstablishTimeout);
          this.connectionEstablishTimeout = null;
        }
      }

      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        this.logger.error(`ICE connection ${pc.iceConnectionState}.`);
        if (!this.isIntentionallyDisconnected) {
          this.scheduleReconnect();
        }
      } else if (pc.iceConnectionState === 'disconnected') {
        this.logger.warn('ICE disconnected — scheduling reconnect in 5s.');
        if (!this.isIntentionallyDisconnected && !this.disconnectedTimeout) {
          this.disconnectedTimeout = setTimeout(() => {
            if (pc === this.pc && !this.isIntentionallyDisconnected) {
              this.logger.warn('ICE connection remained disconnected for 5s. Triggering reconnect.');
              this.scheduleReconnect();
            }
          }, 5000);
        }
      } else if (pc.iceConnectionState === 'connected') {
        this.logger.info('ICE connection connected. Starting 5s stable connection timeout.');
        if (!this.connectionEstablishTimeout) {
          this.connectionEstablishTimeout = setTimeout(() => {
            if (pc === this.pc) {
              this.reconnectAttempts = 0;
            }
          }, 5000);
        }
      }
    };

    // 4. Wire track handler — Encoded Transform for video, native for audio
    pc.ontrack = (event: RTCTrackEvent) => {
      if (pc !== this.pc) return;

      if (event.track.kind === 'video') {
        this.setupVideoEncodedTransform(event.receiver, transformSupport);
      } else if (event.track.kind === 'audio') {
        this.setupNativeAudio(event.streams[0]);
      }
    };

    // 5. Create SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 6. Wait for ICE gathering to complete (or timeout)
    await this.waitForIceGathering(pc);

    const sdpOffer = pc.localDescription?.sdp;
    if (!sdpOffer) {
      throw new Error('Failed to generate SDP offer');
    }

    // 7. POST to WHEP endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);

    try {
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          ...this.extraHeaders,
        },
        body: sdpOffer,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`WHEP endpoint returned ${response.status}: ${response.statusText}`);
      }

      // 8. Parse SDP answer
      const sdpAnswer = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: sdpAnswer,
      }));

      // 9. Save session URL for teardown (DELETE)
      const location = response.headers.get('Location');
      if (location) {
        // Location may be relative — resolve against the request URL
        this.sessionUrl = new URL(location, httpUrl).href;
      }

      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.logger.info(`WHEP session established. Session: ${this.sessionUrl ?? '(no Location header)'}`);
      this.startStatsPolling();
    } catch (err) {
      clearTimeout(timeout);
      this.closePeerConnection(isReconnect);

      if (err instanceof DOMException && err.name === 'AbortError') {
        const timeoutErr = new Error(`WHEP connection timeout after ${this.connectTimeoutMs}ms`);
        if (!isReconnect) {
          this.onError?.(timeoutErr);
          throw timeoutErr;
        }
        this.logger.warn(timeoutErr.message);
        this.scheduleReconnect();
        return;
      }

      if (!isReconnect) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
      this.logger.warn(`Reconnect failed: ${err}`);
      this.scheduleReconnect();
    }
  }

  // ─── Encoded Transform (video) ──────────────────────────────────────

  private setupVideoEncodedTransform(
    receiver: RTCRtpReceiver,
    mode: 'script-transform' | 'encoded-streams',
  ): void {
    this.logger.info(`Setting up Encoded Transform (${mode}) for video receiver.`);

    if (mode === 'encoded-streams') {
      this.setupLegacyEncodedStreams(receiver);
    } else {
      this.setupScriptTransform(receiver);
    }
  }

  /**
   * Legacy path (Chrome 86–109): `receiver.createEncodedStreams()`.
   * Returns a ReadableStream of `RTCEncodedVideoFrame` objects.
   */
  private setupLegacyEncodedStreams(receiver: RTCRtpReceiver): void {
    // @ts-expect-error – non-standard API, not in lib.dom.d.ts
    const { readable } = receiver.createEncodedStreams() as {
      readable: ReadableStream<RTCEncodedVideoFrame>;
      writable: WritableStream<RTCEncodedVideoFrame>;
    };

    const reader = readable.getReader();

    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done || this.isIntentionallyDisconnected) return;
        if (value) {
          this.handleEncodedVideoFrame(value);
        }
        pump();
      }).catch((err) => {
        if (!this.isIntentionallyDisconnected) {
          this.logger.error('Encoded stream read error:', err);
        }
      });
    };
    pump();
  }

  /**
   * Modern path (Chrome 110+): `RTCRtpScriptTransform`.
   * We create a simple transform that intercepts each frame before it reaches
   * the native decoder, extracts the encoded data, and feeds it to `onMockPacket`.
   *
   * Since `RTCRtpScriptTransform` requires a dedicated Worker, and we want to
   * avoid the complexity of bundling a separate worker script for this plugin,
   * we use the `createEncodedStreams`-style approach via the `readable` transform
   * pipeline on the receiver.
   *
   * Note: In Chrome 110+, `createEncodedStreams` still works alongside
   * `RTCRtpScriptTransform`. We prefer the simpler `createEncodedStreams`
   * approach when available, falling back gracefully.
   */
  private setupScriptTransform(receiver: RTCRtpReceiver): void {
    // Even on Chrome 110+, createEncodedStreams is still supported.
    // Use it directly to avoid needing a separate Worker for RTCRtpScriptTransform.
    // @ts-expect-error – non-standard API
    if (typeof receiver.createEncodedStreams === 'function') {
      this.setupLegacyEncodedStreams(receiver);
      return;
    }

    // True RTCRtpScriptTransform path — requires a Worker.
    // Create an inline worker that pipes encoded frames back via postMessage.
    const workerCode = `
      onrtctransform = (event) => {
        const { readable, writable } = event.transformer;
        const reader = readable.getReader();
        const writer = writable.getWriter();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Post frame data to the main thread
            const data = new Uint8Array(value.data);
            self.postMessage({
              data: data.buffer,
              timestamp: value.timestamp,
              type: value.type,
            }, [data.buffer]);
            // Re-create the frame data for the writable side (pass-through)
            // Actually, we consume the frame — don't write to writable to
            // prevent native decoding (we handle it ourselves via WebCodecs).
          }
        };
        pump();
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl, { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      if (this.isIntentionallyDisconnected) return;
      const { data, timestamp, type } = e.data as {
        data: ArrayBuffer;
        timestamp: number;
        type: string;
      };
      this.deliverVideoFrame(new Uint8Array(data), timestamp, isKeyFrame(type));
    };

    receiver.transform = new RTCRtpScriptTransform(worker);

    URL.revokeObjectURL(workerUrl);
  }

  /**
   * Process an `RTCEncodedVideoFrame` from the Encoded Transform pipeline.
   * Extracts the raw encoded bytes and delivers them as a mock packet.
   */
  private handleEncodedVideoFrame(frame: RTCEncodedVideoFrame): void {
    const data = new Uint8Array(frame.data);
    const timestampUs = frame.timestamp; // RTP timestamp in microseconds
    const isKey = isKeyFrame(frame.type);

    this.deliverVideoFrame(data, timestampUs, isKey);
  }

  /**
   * Final delivery point: feeds an encoded video frame into the player's
   * decode pipeline via `onMockPacket`, bypassing the MPEG-TS demuxer.
   */
  private deliverVideoFrame(data: Uint8Array, timestampUs: number, isKey: boolean): void {
    if (this.onMockPacket) {
      this.onMockPacket(data, 'video', timestampUs, isKey);
    }
  }

  // ─── Native Audio (MediaStream → AudioContext) ──────────────────────

  /**
   * Handle the audio track by routing it through the native `AudioContext`.
   * This avoids the complexity of decoding Opus via Encoded Transform and
   * feeds audio directly to the speakers via `createMediaStreamSource`.
   */
  private setupNativeAudio(stream: MediaStream | undefined): void {
    if (!stream) {
      this.logger.warn('Audio track received but no MediaStream available.');
      return;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      // Resume if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch((e) => {
          this.logger.debug('Failed to resume AudioContext:', e);
        });
      }

      this.audioSourceNode = this.audioContext.createMediaStreamSource(stream);
      this.audioSourceNode.connect(this.audioContext.destination);
      this.logger.info('Native audio pipeline established via AudioContext.');
    } catch (err) {
      this.logger.error('Failed to set up native audio:', err);
      // Audio failure is non-fatal — video should still work
    }
  }

  // ─── ICE Gathering ──────────────────────────────────────────────────

  /**
   * Wait for ICE gathering to complete so the offer contains all candidates.
   * Times out after 3 seconds to avoid indefinite stalls on restricted networks.
   */
  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn('ICE gathering timed out after 3s — proceeding with partial candidates.');
        resolve();
      }, 3000);

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
  }

  // ─── Reconnect ──────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return; // Already scheduled

    this.reconnectAttempts++;
    const baseBackoff = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    const jitter = baseBackoff * 0.2 * (Math.random() * 2 - 1);
    const backoff = baseBackoff + jitter;
    this.logger.warn(
      `Scheduling WHEP reconnect attempt #${this.reconnectAttempts} in ${Math.round(backoff)}ms (base: ${baseBackoff}ms)`
    );

    this.connectionState = 'reconnecting';

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      const transformSupport = detectEncodedTransformSupport();
      if (!transformSupport) {
        this.connectionState = 'failed';
        this.onError?.(new Error('Encoded Transform support lost during reconnect'));
        return;
      }
      try {
        await this.connect(this.sourceUrl, transformSupport, true);
      } catch (err) {
        this.logger.error(`Reconnect attempt #${this.reconnectAttempts} failed:`, err);
      }
    }, backoff);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  private closePeerConnection(keepAttempts = false): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.connectionEstablishTimeout) {
      clearTimeout(this.connectionEstablishTimeout);
      this.connectionEstablishTimeout = null;
    }
    if (this.disconnectedTimeout) {
      clearTimeout(this.disconnectedTimeout);
      this.disconnectedTimeout = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Tear down native audio
    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.disconnect();
      } catch (err) {
        this.logger.debug('Failed to disconnect audioSourceNode:', err);
      }
      this.audioSourceNode = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (err) {
        this.logger.debug('Failed to close audioContext:', err);
      }
      this.audioContext = null;
    }

    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onicegatheringstatechange = null;
        this.pc.close();
      } catch (err) {
        this.logger.debug('Failed to close RTCPeerConnection:', err);
      }
      this.pc = null;
    }

    if (!keepAttempts) {
      this.reconnectAttempts = 0;
    }
  }

  private disconnect(): void {
    this.isIntentionallyDisconnected = true;
    this.connectionState = 'closed';

    // DELETE WHEP session (fire-and-forget)
    if (this.sessionUrl) {
      fetch(this.sessionUrl, {
        method: 'DELETE',
        headers: this.extraHeaders,
      }).catch((err) => {
        this.logger.debug('Failed to delete WHEP session:', err);
      });
      this.sessionUrl = null;
    }

    this.closePeerConnection();
  }

  public getThroughput(): { throughputKbps: number; throughputSamples: number } {
    return {
      throughputKbps: Math.round(this.smoothedThroughputKbps),
      throughputSamples: this.throughputSamplesCount,
    };
  }

  private startStatsPolling() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    this.lastBytesReceived = 0;
    this.lastTimestamp = 0;

    this.statsInterval = setInterval(async () => {
      if (!this.pc || this.pc.signalingState === 'closed') return;
      try {
        const stats = await this.pc.getStats();
        let currentBytes = 0;
        let currentTimestamp = performance.now();
        
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            currentBytes = report.bytesReceived || 0;
          }
        });

        if (this.lastTimestamp > 0 && currentBytes >= this.lastBytesReceived) {
          const bytesDiff = currentBytes - this.lastBytesReceived;
          const timeDiffMs = currentTimestamp - this.lastTimestamp;
          if (timeDiffMs > 0) {
            const sampleKbps = (bytesDiff * 8) / timeDiffMs;
            if (this.smoothedThroughputKbps === 0) {
              this.smoothedThroughputKbps = sampleKbps;
            } else {
              this.smoothedThroughputKbps = this.alpha * sampleKbps + (1 - this.alpha) * this.smoothedThroughputKbps;
            }
            this.throughputSamplesCount++;
          }
        }
        
        this.lastBytesReceived = currentBytes;
        this.lastTimestamp = currentTimestamp;
      } catch (e) {
        this.logger.warn('Failed to fetch RTC stats:', e);
      }
    }, 1000);
  }

  // ─── QualitySource implementation ───────────────────────────────────
  public getLevels(): QualityLevel[] {
    return this.qualityLevels;
  }

  public getActiveId(): string {
    return this.activeQualityId;
  }

  public async switchQuality(id: string): Promise<void> {
    const level = this.qualityLevels.find(l => l.id === id);
    if (!level) return;
    if (this.activeQualityId === id) return;

    this.logger.info(`WHEPLoader switching quality to: ${id} (${level.url})`);
    this.activeQualityId = id;
    this.sourceUrl = level.url;

    this.disconnect();
    
    const transformSupport = detectEncodedTransformSupport();
    if (transformSupport) {
      await this.connect(level.url, transformSupport);
    }
  }

  private getStreamLevels(url: string): QualityLevel[] {
    try {
      const u = new URL(url);
      let mainUrl = url;
      let subUrl = url;
      let detected = false;

      if (u.searchParams.has('stream')) {
        const stream = u.searchParams.get('stream');
        if (stream === 'sub') {
          detected = true;
          u.searchParams.set('stream', 'main');
          mainUrl = u.toString();
        } else if (stream === 'main') {
          detected = true;
          u.searchParams.set('stream', 'sub');
          subUrl = u.toString();
        }
      } else if (u.pathname.endsWith('/sub')) {
        detected = true;
        mainUrl = url.replace(/\/sub$/, '/main');
      } else if (u.pathname.endsWith('/main')) {
        detected = true;
        subUrl = url.replace(/\/main$/, '/sub');
      } else if (u.pathname.endsWith('_sub')) {
        detected = true;
        mainUrl = url.replace(/_sub$/, '_main');
      } else if (u.pathname.endsWith('_main')) {
        detected = true;
        subUrl = url.replace(/_main$/, '_sub');
      }

      if (detected) {
        return [
          { id: 'main', label: 'Main (High)', url: mainUrl, kind: 'main' },
          { id: 'sub', label: 'Sub (Low)', url: subUrl, kind: 'sub' }
        ];
      }
    } catch (e) {
      this.logger.error('Failed to parse WHEP URL for quality levels:', e);
    }

    const defaultSubUrl = url.includes('?') ? `${url}&stream=sub` : `${url}?stream=sub`;
    return [
      { id: 'main', label: 'Main (High)', url: url, kind: 'main' },
      { id: 'sub', label: 'Sub (Low)', url: defaultSubUrl, kind: 'sub' }
    ];
  }
}
