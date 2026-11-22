/**
 * @module @yumyum-player/pro-streaming
 *
 * Yum-yum Player plugin for ultra-low-latency live streaming over
 * WebSocket (sub-200ms), plus an on-prem RTSP→MPEG-TS repackaging server
 * (see `server/`). The repackager runs inside the customer's own network, so
 * traffic never leaves their perimeter — suitable for closed/air-gapped sites.
 *
 * @example
 * ```typescript
 * import { YumYumPlayer } from '@yumyum-player/core';
 * import { proStreaming } from '@yumyum-player/pro-streaming';
 *
 * const player = new YumYumPlayer({
 *   canvas,
 *   plugins: [proStreaming()],
 * });
 * await player.load('ws://localhost:3002/?url=rtsp://camera/stream');
 * ```
 */
import type { PlayerPlugin } from '@yumyum-player/core';
import { WSLoader } from './WSLoader.js';

/**
 * Create the low-latency streaming plugin. It registers a WebSocket loader for
 * `ws://` and `wss://` URLs.
 */
export function proStreaming(): PlayerPlugin {
  return {
    name: '@yumyum-player/pro-streaming',
    install(ctx) {
      ctx.registerLoader(['ws', 'wss'], (deps) => new WSLoader(deps));
      ctx.logger.info('pro-streaming: registered low-latency WebSocket loader (ws/wss).');
    },
  };
}

export { WSLoader } from './WSLoader.js';
