/**
 * @module @yumyum-player/transport-webrtc
 *
 * Yum-yum Player plugin for low-latency live video transport over
 * WebRTC/WHEP (sub-second latency). Uses Encoded Transform (insertable
 * streams) to feed encoded video frames directly into the player's
 * WebCodecs+WebGL pipeline — preserving overlays, `chrome:'none'`, and
 * the unified progress bar.
 *
 * Requires a WHEP-compatible server (e.g. MediaMTX). Audio is handled
 * natively via `MediaStream → AudioContext`.
 *
 * @example
 * ```typescript
 * import { YumYumPlayer } from '@yumyum-player/core';
 * import { transportWebrtc } from '@yumyum-player/transport-webrtc';
 *
 * const player = new YumYumPlayer({
 *   canvas,
 *   plugins: [transportWebrtc()],
 * });
 * await player.load('whep://vms.local/whep/cam_1/whep');
 * ```
 */
import type { PlayerPlugin } from '@yumyum-player/core';
import { WHEPLoader, type WHEPLoaderOptions } from './WHEPLoader.js';

export type TransportWebrtcOptions = WHEPLoaderOptions;

/**
 * Create the low-latency WebRTC/WHEP transport plugin. It registers a WHEP
 * loader for `whep://` and `whep+https://` URLs.
 */
export function transportWebrtc(options: TransportWebrtcOptions = {}): PlayerPlugin {
  return {
    name: '@yumyum-player/transport-webrtc',
    install(ctx) {
      ctx.registerLoader(['whep', 'whep+https'], (deps) =>
        new WHEPLoader(deps, ctx.logger, options),
      );
      ctx.logger.info('transport-webrtc: registered WHEP loader (whep/whep+https).');
    },
  };
}

export { WHEPLoader } from './WHEPLoader.js';
export type { WHEPLoaderOptions, WHEPConnectionState } from './WHEPLoader.js';
export { whepToHttpUrl, detectEncodedTransformSupport } from './WHEPLoader.js';
