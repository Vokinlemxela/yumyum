import type { IBaseDecoder, DecoderDeps } from '@yumyum-player/core';

export interface WorkerDecoderOptions {
  /** URL of the decode worker (`worker/decode-worker.js`), served statically. */
  workerUrl: string;
  /** URL of the Emscripten glue (`hevc.js`). */
  glueUrl: string;
  /** Decode thread count (passed to libde265). */
  threads?: number;
}

interface FrameMessage {
  type: 'frame';
  pts: number;
  bitmap: ImageBitmap;
}
type WorkerMessage = FrameMessage | { type: 'ready' } | { type: 'error'; message: string };

/**
 * Runs the libde265 WASM decoder in a dedicated Web Worker so software HEVC
 * decoding happens off the main thread — keeping rendering and the HLS/WS loop
 * smooth. Frames are delivered asynchronously, like native WebCodecs.
 */
export class WasmHevcWorkerDecoder implements IBaseDecoder {
  private worker: Worker | null = null;
  private isDestroyed = false;
  private isFailed = false;

  constructor(private deps: DecoderDeps, opts: WorkerDecoderOptions) {
    try {
      this.worker = new Worker(opts.workerUrl, { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'frame') {
          if (this.isDestroyed) {
            m.bitmap.close();
            return;
          }
          this.deps.onFrame({ pts: m.pts / 1_000_000, duration: 33333 / 1_000_000, data: m.bitmap });
        } else if (m.type === 'ready') {
          this.deps.logger.info('WASM HEVC worker ready.');
        } else if (m.type === 'error') {
          this.fail('hevc-wasm worker: ' + m.message);
        }
      };
      this.worker.onerror = (ev) => {
        this.fail('hevc-wasm worker error: ' + (ev.message || 'unknown'));
      };
      this.worker.postMessage({ type: 'init', glueUrl: opts.glueUrl, threads: opts.threads ?? 0 });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Report a fatal error once and stop the worker to avoid error spam. */
  private fail(message: string): void {
    if (this.isFailed || this.isDestroyed) return;
    this.isFailed = true;
    this.deps.onError(new Error(message));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public isSoftwareFallback(): boolean {
    return true;
  }

  public decode(packet: Uint8Array, timestampUs: number): void {
    if (this.isDestroyed || this.isFailed || !this.worker) return;
    // Copy into a standalone transferable buffer (packet may be a view).
    const buf = packet.slice().buffer;
    this.worker.postMessage({ type: 'decode', data: buf, pts: timestampUs }, [buf]);
  }

  public flush(): void {
    this.worker?.postMessage({ type: 'reset' });
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.worker) {
      this.worker.postMessage({ type: 'destroy' });
      this.worker.terminate();
      this.worker = null;
    }
  }
}
