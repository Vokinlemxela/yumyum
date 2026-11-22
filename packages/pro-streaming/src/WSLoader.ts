import type { IStreamLoader, LoaderDeps, LoaderKind, Logger, QualityLevel, QualitySource } from '@yumyum-player/core';

/**
 * Ultra-low-latency WebSocket loader: receives a continuous MPEG-TS byte stream
 * over a WebSocket and feeds it to the player's demuxer. Registered for ws://
 * and wss:// by the proStreaming() plugin.
 */
export class WSLoader implements IStreamLoader, QualitySource {
  /** Live WS is push-driven: it streams continuously once connected. */
  public readonly kind: LoaderKind = 'push';
  public readonly quality: QualitySource = this;

  private qualityLevels: QualityLevel[] = [];
  private activeQualityId = 'main';

  private ws: WebSocket | null = null;
  private isDownloading = false;
  private isIntentionallyDisconnected = false;

  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private connectionEstablishTimeout: ReturnType<typeof setTimeout> | null = null;

  private bytesReceivedCount = 0;
  private smoothedThroughputKbps = 0;
  private throughputSamplesCount = 0;
  private alpha = 0.15;
  private throughputInterval: ReturnType<typeof setInterval> | null = null;

  private onSegmentLoaded: ((chunk: ArrayBuffer) => void) | null;
  private logger: Logger;
  private onError: ((err: Error) => void) | null;

  constructor(deps: LoaderDeps) {
    this.onSegmentLoaded = (chunk) => deps.onData(chunk, true);
    this.logger = deps.logger;
    this.onError = deps.onError;
  }

  // ─── IStreamLoader ──────────────────────────────────────────────────
  public load(url: string): Promise<void> {
    this.qualityLevels = this.getStreamLevels(url);
    const activeLevel = this.qualityLevels.find(l => l.id === this.activeQualityId) || this.qualityLevels[0];
    this.activeQualityId = activeLevel.id;
    return this.connect(activeLevel.url);
  }

  /** Live stream pushes data on connect; there is nothing to start on demand. */
  public start(isBackpressured: () => boolean): void {}

  /** Pausing keeps the socket open so the live edge stays current. */
  public stop(): void {}

  /** Seeking is not supported on a live stream. */
  public seek(timeSeconds: number): boolean {
    return false;
  }

  public getDuration(): number {
    return Infinity;
  }

  public async connect(url: string, isReconnect = false): Promise<void> {
    this.disconnect(isReconnect);
    this.isIntentionallyDisconnected = false;

    return new Promise((resolve, reject) => {
      try {
        this.logger.debug('Connecting to:', url);
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
          if (ws !== this.ws) return;
          if (ws.readyState !== WebSocket.OPEN) {
            this.logger.warn(`Connection timeout. Closing WebSocket connection attempt to: ${url}`);
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

        ws.onopen = () => {
          if (ws !== this.ws) return;
          if (this.isIntentionallyDisconnected) return;
          clearTimeout(connectTimeout);
          this.logger.debug('WebSocket connection established successfully.');
          this.isDownloading = true;

          this.bytesReceivedCount = 0;
          if (this.throughputInterval) {
            clearInterval(this.throughputInterval);
          }
          this.throughputInterval = setInterval(() => {
            if (this.isIntentionallyDisconnected) return;
            const sampleKbps = (this.bytesReceivedCount * 8) / 1000;
            this.bytesReceivedCount = 0;
            if (this.smoothedThroughputKbps === 0) {
              this.smoothedThroughputKbps = sampleKbps;
            } else {
              this.smoothedThroughputKbps = this.alpha * sampleKbps + (1 - this.alpha) * this.smoothedThroughputKbps;
            }
            this.throughputSamplesCount++;
          }, 1000);

          // Reset reconnect attempts after 5 seconds of stable connection
          this.connectionEstablishTimeout = setTimeout(() => {
            if (ws === this.ws) {
              this.reconnectAttempts = 0;
            }
          }, 5000);

          // Start heartbeat to keep connection alive
          this.heartbeatInterval = setInterval(() => {
            if (ws !== this.ws) return;
            if (this.isIntentionallyDisconnected) return;
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send('ping');
              } catch (e) {
                this.logger.error('Failed to send heartbeat ping:', e);
              }
            }
          }, 5000);

          resolve();
        };

        ws.onmessage = (event: MessageEvent) => {
          if (ws !== this.ws) return;
          if (this.isIntentionallyDisconnected) return;
          if (event.data instanceof ArrayBuffer) {
            this.bytesReceivedCount += event.data.byteLength;
            if (this.onSegmentLoaded) {
              this.onSegmentLoaded(event.data);
            }
          }
        };

        ws.onerror = (err) => {
          if (ws !== this.ws) return;
          if (this.isIntentionallyDisconnected) return;
          clearTimeout(connectTimeout);
          this.logger.error('WebSocket error occurred:', err);
          reject(err);
        };

        ws.onclose = (event) => {
          if (ws !== this.ws) return;
          if (this.isIntentionallyDisconnected) return;
          clearTimeout(connectTimeout);
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
          }
          this.logger.warn(`Connection closed. Code: ${event.code}, Reason: ${event.reason || 'None'}`);
          const wasDownloading = this.isDownloading;
          this.isDownloading = false;

          const shouldReconnect = !this.isIntentionallyDisconnected && (wasDownloading || isReconnect);
          if (shouldReconnect) {
            this.scheduleReconnect(url);
          }
        };
      } catch (err) {
        this.logger.error('Failed to instantiate WebSocket:', err);
        reject(err);
      }
    });
  }

  private scheduleReconnect(url: string) {
    if (this.reconnectTimeout) return; // Reconnect already scheduled

    this.reconnectAttempts++;
    const baseBackoff = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    const jitter = baseBackoff * 0.2 * (Math.random() * 2 - 1);
    const backoff = baseBackoff + jitter;
    this.logger.warn(`Scheduling reconnect attempt #${this.reconnectAttempts} in ${Math.round(backoff)}ms (base: ${baseBackoff}ms) to: ${url}`);

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect(url, true);
      } catch (err) {
        this.logger.error(`Reconnect attempt #${this.reconnectAttempts} failed:`, err);
      }
    }, backoff);
  }

  public disconnect(keepAttempts = false): void {
    this.isIntentionallyDisconnected = true;
    this.isDownloading = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.connectionEstablishTimeout) {
      clearTimeout(this.connectionEstablishTimeout);
      this.connectionEstablishTimeout = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.throughputInterval) {
      clearInterval(this.throughputInterval);
      this.throughputInterval = null;
    }
    if (!keepAttempts) {
      this.reconnectAttempts = 0;
    }

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (e) {
        this.logger.debug('Failed to close WebSocket connection:', e);
      }
      this.ws = null;
    }
  }

  public destroy(): void {
    this.disconnect();
    this.onSegmentLoaded = null;
  }

  public getThroughput(): { throughputKbps: number; throughputSamples: number } {
    return {
      throughputKbps: Math.round(this.smoothedThroughputKbps),
      throughputSamples: this.throughputSamplesCount,
    };
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

    this.logger.info(`WSLoader switching quality to: ${id} (${level.url})`);
    this.activeQualityId = id;
    
    this.disconnect(true);
    await this.connect(level.url);
  }

  public getConnectionState(): string {
    if (this.reconnectTimeout || this.reconnectAttempts > 0) {
      return 'reconnecting';
    }
    return this.ws && this.ws.readyState === WebSocket.OPEN ? 'connected' : 'connecting';
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
      this.logger.error('Failed to parse WS URL for quality levels:', e);
    }

    const defaultSubUrl = url.includes('?') ? `${url}&stream=sub` : `${url}?stream=sub`;
    return [
      { id: 'main', label: 'Main (High)', url: url, kind: 'main' },
      { id: 'sub', label: 'Sub (Low)', url: defaultSubUrl, kind: 'sub' }
    ];
  }
}
