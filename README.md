# Yum-yum Player

English · [Русский](./README.ru.md)

Yum-yum Player is an open-source browser video engine for HLS, WebRTC/WHEP and WebSocket. It decodes video with WebCodecs and renders it to a canvas using WebGL2. The core and all three plugins are free to use.

| Package | Features |
| --- | --- |
| [`@yumyum-player/core`](./packages/player-sdk/README.md) | HLS (MPEG-TS and fMP4), H.264, native HEVC, MJPEG, AAC and A/V synchronization |
| [`@yumyum-player/transport-webrtc`](./packages/transport-webrtc/README.md) | Live playback over WebRTC/WHEP |
| [`@yumyum-player/pro-streaming`](./packages/pro-streaming/README.md) | WebSocket transport and an FFmpeg server that remuxes RTSP into MPEG-TS |
| [`@yumyum-player/hevc-wasm`](./packages/hevc-wasm/README.md) | Software HEVC decoding with WebAssembly and libde265 |

React playback controls are available separately in [`@yumyums/ui`](https://www.npmjs.com/package/@yumyums/ui).

## Getting started

```bash
npm install @yumyum-player/core
```

```ts
import { YumYumPlayer } from '@yumyum-player/core';

const canvas = document.querySelector('canvas')!;
const player = new YumYumPlayer({ canvas });
await player.load('https://example.com/stream.m3u8');
await player.play();
```

To try playback without a streaming server, use `mock://h264`. Each package's README includes an example of how to connect its plugin.

## Building from source

Use Node.js 22.12 or later and npm 11. The RTSP server and the HLS packaging utility require FFmpeg on `PATH`. Run the [HLS packager](./packages/hls-packager) with `npm run package`.

```bash
npm ci
npm run build
npm run typecheck
npm test
```

## Examples and diagnostics

The [plugin guide](./docs/plugins.md) covers WHEP, WebSocket and software HEVC. To test local streams, build the packages, run `npm run dev:debugger` and open `http://127.0.0.1:3003`. The debugger uses FFmpeg to process RTSP streams and uploaded files.

## Licensing

Player's source code is available under the [MIT License](./LICENSE). The HEVC package includes libde265 under LGPL-3.0-or-later, along with its [source and license notices](./packages/hevc-wasm/third-party/README.md).

[Changelog](./CHANGELOG.md)
