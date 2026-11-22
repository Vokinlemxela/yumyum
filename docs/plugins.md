# Connecting Yum-yum Player plugins

English · [Русский](./plugins.ru.md)

The core plays HLS and uses the browser's native decoders. Three free plugins add software HEVC decoding, WebSocket transport and WebRTC/WHEP. Install the core and the plugins your application uses.

```sh
npm install @yumyum-player/core @yumyum-player/hevc-wasm @yumyum-player/pro-streaming @yumyum-player/transport-webrtc
```

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';
import { proStreaming } from '@yumyum-player/pro-streaming';
import { transportWebrtc } from '@yumyum-player/transport-webrtc';

const player = new YumYumPlayer({
  canvas,
  plugins: [
    hevcWasm({ workerUrl: '/hevc/decode-worker.js', glueUrl: '/hevc/hevc.js' }),
    proStreaming(),
    transportWebrtc(),
  ],
});

await player.load('whep+https://media.example.com/camera/whep');
```

## HEVC WASM

Copy `worker/decode-worker.js`, `wasm/hevc.js` and `wasm/hevc.wasm` from the npm package to the `/hevc/` directory on your site. Pass the paths to the worker and the JavaScript loader to `hevcWasm()` as shown above. Player selects the software decoder when native HEVC is unavailable. Set `forceSoftwareHevc: true` in the player configuration to select it explicitly.

The bundled libde265 decoder is single-threaded. Running it in a Web Worker keeps decoding off the UI thread. The build requires standard Worker and WebAssembly support. The [HEVC package guide](../packages/hevc-wasm/README.md) covers licensing and building the decoder.

## WebSocket

`proStreaming()` registers the `ws://` and `wss://` schemes. To start the RTSP server from the repository, run the command below with Node.js and FFmpeg on `PATH`.

```sh
WS_HOST=127.0.0.1 WS_PORT=3002 RTSP_ALLOWED_HOSTS=camera.local npm run serve -w @yumyum-player/pro-streaming
```

The server remuxes RTSP video into MPEG-TS without re-encoding. Pass the camera's RTSP address as the `url` query parameter of the WebSocket URL.

```ts
const stream = new URL('ws://localhost:3002/');
stream.searchParams.set('url', 'rtsp://camera.local/stream');
stream.searchParams.set('codec', 'h265');
await player.load(stream.href);
```

In this example the server listens on the loopback interface and accepts `camera.local` as a destination. For access from another network, configure the listening address, allowed camera hosts and authentication. [WebSocket server settings](../packages/pro-streaming/README.md)

## WebRTC/WHEP

`transportWebrtc()` connects to a WHEP endpoint, such as MediaMTX. Use `whep+https://` for HTTPS and `whep://` for HTTP. The browser needs Encoded Transform support to pass video frames to WebCodecs. Use `rtcConfig` for ICE servers and `extraHeaders` for source authentication. [WebRTC/WHEP settings](../packages/transport-webrtc/README.md)
