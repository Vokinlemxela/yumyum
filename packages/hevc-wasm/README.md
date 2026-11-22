**English** · [Русский](https://github.com/Vokinlemxela/yumyum/blob/v1.1.1/packages/hevc-wasm/README.ru.md)

# @yumyum-player/hevc-wasm

Software HEVC/H.265 decoder for [Yum-yum Player](../player-sdk/README.md). It decodes HEVC in WebAssembly on browsers and devices that lack native HEVC decoding.

```sh
npm install @yumyum-player/core @yumyum-player/hevc-wasm
```

## Getting started

`hevcWasm()` registers the software decoder as `h265-sw`. The core uses it when native HEVC decoding is unavailable or when you pass `forceSoftwareHevc: true` to the player.

For a bundled web application, copy `wasm/hevc.js`, `wasm/hevc.wasm`, and `worker/decode-worker.js` from the installed package to a public directory. Keep `hevc.js` and `hevc.wasm` in the same directory. Create a `<canvas id="player">` element and pass the matching asset URLs to the plugin.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [
    hevcWasm({ glueUrl: '/hevc/hevc.js', workerUrl: '/hevc/decode-worker.js' }),
  ],
});
```

When the runtime can resolve the packaged WASM assets directly, `hevcWasm()` without arguments loads the bundled decoder on the main thread.

## Backend interface

The plugin integrates with Player by registering `h265-sw`. `WasmHevcDecoder` manages the decoder lifecycle, maintains a bounded NAL queue during startup, and delivers frames to the player. `HevcWasmBackend` defines the interchangeable codec implementation. [Backend types](./src/backend.ts).

```ts
interface RgbaFrame {
  width: number;
  height: number;
  pts: number;
  data: Uint8Array;
}

interface HevcWasmBackend {
  init(): Promise<void>;
  decode(accessUnit: Uint8Array, pts: number): RgbaFrame | null;
  reset(): void;
  destroy(): void;
}
```

`decode()` takes one Annex B access unit with start codes and a presentation timestamp in microseconds. It returns a packed RGBA frame in display order, or `null` while the decoder needs more input. The returned frame carries its own display timestamp in microseconds.

## WASM binary (libde265)

The default `createLibde265Backend()` uses **libde265 1.1.3**. The `native/build.sh` script uses Emscripten to generate `wasm/hevc.js` and `wasm/hevc.wasm`. The bundled build is single-threaded with 256 MiB of fixed memory (`ALLOW_MEMORY_GROWTH=0`) and an 8 MiB stack. This configuration avoids heap corruption observed with pthreads and memory growth in nested workers. Providing both `workerUrl` and `glueUrl` runs the codec in a dedicated Web Worker, leaving the main thread available for the interface.

### Browser isolation and threading

The bundled build uses ordinary WebAssembly memory and works without `SharedArrayBuffer` or COOP/COEP headers. The `threads` option and the browser's `hardwareConcurrency` value do not change the decoder's thread count in this build.

### Playback status

The libde265 backend supports HEVC over HLS from uploaded files and RTSP-to-HLS repackaging. With some raw IP-camera feeds over low-latency WebSocket, the bundled decoder produces only IDR frames.

### Rebuilding the binary

Install Emscripten, CMake and Node.js. On macOS you can install Emscripten and CMake with Homebrew.

```sh
brew install cmake emscripten
```

Build from the repository root.

```sh
npm run wasm -w @yumyum-player/hevc-wasm
```

### Using a custom backend

Pass your own `HevcWasmBackend` with `hevcWasm({ backend })`. This backend overrides worker mode and runs on the main thread.

## Licenses

The Player integration code is licensed under [MIT](./LICENSE). The bundled [libde265](https://github.com/strukturag/libde265) build is distributed under LGPL-3.0-or-later. The package includes its source archive and license texts. [Third-party components](./third-party/README.md).
