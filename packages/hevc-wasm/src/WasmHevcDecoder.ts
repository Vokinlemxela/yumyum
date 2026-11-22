import type { IBaseDecoder, DecoderDeps } from '@yumyum-player/core';
import type { HevcWasmBackend } from './backend.js';

/**
 * Adapts a {@link HevcWasmBackend} to the player's `IBaseDecoder` contract.
 * Registered by the plugin under the `h265-sw` key; the core's native
 * HEVCDecoder delegates to it when the browser lacks native HEVC support.
 */
export class WasmHevcDecoder implements IBaseDecoder {
  private isReady = false;
  private isDestroyed = false;
  private initStarted = false;
  private queue: Array<{ accessUnit: Uint8Array; timestampUs: number }> = [];

  constructor(private deps: DecoderDeps, private backend: HevcWasmBackend) {}

  public isSoftwareFallback(): boolean {
    return true;
  }

  /** Lazily load the WASM module on first use, so it is never fetched for
   *  streams that play via native decoding. */
  private ensureInit(): void {
    if (this.initStarted) return;
    this.initStarted = true;
    this.backend
      .init()
      .then(() => {
        if (this.isDestroyed) return;
        this.isReady = true;
        this.deps.logger.info('WASM HEVC backend initialized.');
        this.drainQueue();
      })
      .catch((err) => {
        this.deps.onError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  public decode(packet: Uint8Array, timestampUs: number): void {
    if (this.isDestroyed) return;
    this.ensureInit();

    if (!this.isReady) {
      // Buffer a bounded number of access units until the WASM module is ready.
      if (this.queue.length < 256) {
        this.queue.push({ accessUnit: packet, timestampUs });
      }
      return;
    }

    this.decodeNow(packet, timestampUs);
  }

  private decodeNow(accessUnit: Uint8Array, timestampUs: number): void {
    try {
      const frame = this.backend.decode(accessUnit, timestampUs);
      if (!frame) return;
      // Build an ImageBitmap from the RGBA frame and deliver it via the fast
      // drawImage path (no WebGL needed). Use the decoder's display-order PTS.
      const image = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
      const framePts = frame.pts;
      createImageBitmap(image)
        .then((bitmap) => {
          if (this.isDestroyed) {
            bitmap.close();
            return;
          }
          this.deps.onFrame({ pts: framePts / 1_000_000, duration: 33333 / 1_000_000, data: bitmap });
        })
        .catch((err) => this.deps.onError(err instanceof Error ? err : new Error(String(err))));
    } catch (err) {
      this.deps.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private drainQueue(): void {
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) {
      if (this.isDestroyed) return;
      this.decodeNow(item.accessUnit, item.timestampUs);
    }
  }

  public flush(): void {
    this.queue = [];
    if (this.isReady) this.backend.reset();
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.queue = [];
    this.backend.destroy();
  }
}
