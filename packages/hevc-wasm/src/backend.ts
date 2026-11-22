/** A decoded picture as packed RGBA (BT.709), ready for an ImageBitmap. */
export interface RgbaFrame {
  width: number;
  height: number;
  /** Display-order presentation timestamp in microseconds. */
  pts: number;
  /** Tightly packed RGBA, length === width * height * 4. */
  data: Uint8Array;
}

/**
 * A WASM-backed HEVC frame decoder.
 *
 * This is the swappable codec core. The plugin provides the player
 * glue (plugin contract, lifecycle, NAL queueing); the actual
 * software decode is delivered by a backend so the heavy WASM binary can be
 * built and shipped independently (e.g. an emscripten libde265 / ffmpeg.wasm
 * build, or a vetted third-party module).
 */
export interface HevcWasmBackend {
  /** Initialize the WASM module. Resolves when ready to decode. */
  init(): Promise<void>;
  /**
   * Decode one HEVC access unit (Annex-B, start codes included), tagged with
   * `pts` (microseconds). Returns a packed RGBA frame in display order, or
   * `null` if the decoder needs more data before emitting one.
   */
  decode(accessUnit: Uint8Array, pts: number): RgbaFrame | null;
  /** Reset decoder state (e.g. on seek/flush). */
  reset(): void;
  /** Release the WASM instance and all buffers. */
  destroy(): void;
}
