/**
 * @module @yumyum-player/hevc-wasm
 *
 * Yum-yum Player plugin for a software (WASM) HEVC/H.265 decoder that
 * plays HEVC even on browsers/devices without native support (Firefox, Linux,
 * Chrome without hardware HEVC, older devices).
 *
 * @example
 * ```typescript
 * import { YumYumPlayer } from '@yumyum-player/core';
 * import { hevcWasm } from '@yumyum-player/hevc-wasm';
 *
 * const player = new YumYumPlayer({
 *   canvas,
 *   plugins: [hevcWasm()],
 * });
 * ```
 */
import type { PlayerPlugin } from '@yumyum-player/core';
import { WasmHevcDecoder } from './WasmHevcDecoder.js';
import { WasmHevcWorkerDecoder } from './WasmHevcWorkerDecoder.js';
import { createLibde265Backend } from './libde265Backend.js';
import type { HevcWasmBackend } from './backend.js';

export interface HevcWasmOptions {
  /**
   * URL of the decode worker (`worker/decode-worker.js`), served statically.
   * When set (recommended), decoding runs off the main thread for smooth HD —
   * this is the preferred mode.
   */
  workerUrl?: string;
  /** URL of the Emscripten glue (`hevc.js`). Required for worker mode. */
  glueUrl?: string;
  /** Decode thread count (libde265 worker threads). Defaults to hardwareConcurrency. */
  threads?: number;
  /**
   * Explicit synchronous codec backend (main thread). Overrides worker mode —
   * mainly for Node/tests or a custom codec module.
   */
  backend?: HevcWasmBackend;
}

/**
 * Create the HEVC-WASM plugin. It registers a software decoder under the
 * `h265-sw` key; the core's native HEVCDecoder delegates to it automatically
 * when native HEVC is unavailable (or when forced).
 *
 * Decoder selection:
 *  - `backend` given            -> synchronous main-thread decoder (advanced/Node)
 *  - `workerUrl` given + Worker  -> off-main-thread worker decoder (preferred)
 *  - otherwise                   -> synchronous main-thread libde265
 */
export function hevcWasm(options: HevcWasmOptions = {}): PlayerPlugin {
  return {
    name: '@yumyum-player/hevc-wasm',
    install(ctx) {
      ctx.registerDecoder('h265-sw', (deps) => {
        if (options.backend) {
          return new WasmHevcDecoder(deps, options.backend);
        }
        if (typeof Worker !== 'undefined' && options.workerUrl && options.glueUrl) {
          return new WasmHevcWorkerDecoder(deps, {
            workerUrl: options.workerUrl,
            glueUrl: options.glueUrl,
            threads: options.threads,
          });
        }
        // Fallback: synchronous main-thread libde265 (e.g. Node, or no worker URL).
        return new WasmHevcDecoder(deps, createLibde265Backend({ glueUrl: options.glueUrl, threads: options.threads }));
      });
      ctx.logger.info('hevc-wasm: registered software HEVC decoder (h265-sw).');
    },
  };
}

export { createLibde265Backend } from './libde265Backend.js';
export type { Libde265Options } from './libde265Backend.js';
export type { HevcWasmBackend } from './backend.js';
export { WasmHevcDecoder } from './WasmHevcDecoder.js';
export { WasmHevcWorkerDecoder } from './WasmHevcWorkerDecoder.js';
export type { WorkerDecoderOptions } from './WasmHevcWorkerDecoder.js';
