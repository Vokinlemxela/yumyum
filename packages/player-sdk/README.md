# @yumyum-player/core

**English** · [Русский](https://github.com/Vokinlemxela/yumyum/blob/v1.1.1/packages/player-sdk/README.ru.md)

Yum-yum Player is a browser video engine for live streams and archives. The MIT-licensed core plays HLS on a canvas, demuxes MPEG-TS and fragmented MP4 (fMP4), and synchronizes video with audio. Free, open-source plugins add software HEVC decoding, WebSocket streaming and WebRTC/WHEP. [Engine plugins](#engine-plugins)

## Installation

```bash
npm install @yumyum-player/core
```

The package embeds its demux worker and PCM audio worklet as Blob sources. Installing the core supplies both.

## Quick start

Add a `<canvas></canvas>` to the page, then load a playlist and start playback.

```ts
import { YumYumPlayer } from '@yumyum-player/core';

const canvas = document.querySelector('canvas')!;
const player = new YumYumPlayer({ canvas });

await player.load('https://example.com/stream.m3u8');
await player.play();
```

For a local demo without a media server, replace the playlist URL with `mock://h264`, `mock://hevc` or `mock://mjpeg`.

## Core capabilities

| Area | Support |
|---|---|
| Video | H.264/AVC and HEVC/H.265 through the browser's WebCodecs decoders. MJPEG frames are decoded with `createImageBitmap`. |
| Audio | AAC through `AudioDecoder` using raw frames or ADTS. When native AAC decoding is unavailable, the player tries Web Audio `decodeAudioData`. An `AudioWorklet` plays PCM. |
| Sources | HLS with MPEG-TS or fMP4 segments, progressive fragmented MP4, and built-in `mock://` streams. The demuxer extracts video access units and AAC audio. |
| Rendering | WebGL2 supports YUV rendering. A 2D canvas fallback is available. |
| A/V synchronization | The playback clock follows the audio clock when available. |
| Recovery | Decoder recovery and profile changes, frame-queue backpressure, MPEG-TS sync-byte checks, and catch-up to the live edge. |

## Configuration

Only `canvas` is required. This example limits video processing and rendering to 8 fps for a grid cell. Omit the frame-rate limits for normal playback. The `lowPower` preset defaults both limits to 8 fps and reduces the frame queue.

```ts
new YumYumPlayer({
  canvas,                     // Required HTMLCanvasElement
  volume: 0.8,                // Range 0–1, default 1
  muted: false,               // Start muted if true
  placeholderStyle: 'black',  // 'black' (default), 'no-signal', or 'none'
  logLevel: 'silent',         // 'silent' (default), 'error', 'warn', 'info', or 'debug'
  forceSoftwareHevc: false,   // Prefer a registered h265-sw decoder if true
  targetFps: 8,               // Limit video frame processing
  renderFps: 8,               // Limit the render loop independently
  lowPower: false,            // Use the low-power grid preset if true
  plugins: [],                // Install decoder or transport plugins
});
```

## API

```ts
// Playback
await player.load(url);
await player.play();
player.pause();
player.seek(seconds);                     // For seekable sources
player.state;                             // PlayerLifecycleState

// Audio and speed
player.setVolume(0.5);
player.mute(true);
await player.unlockAudio();               // Call from a user gesture
player.setPlaybackRate(1.5);
player.getPlaybackRate();
player.setLowPower(true);

// Quality and adaptive bitrate (ABR)
player.getQualityLevels();                // QualityLevel[]
player.getActiveQuality();                // 'auto' or the loader's selected ID
player.getActiveRenditionKind();          // 'main', 'sub', or null
await player.setQuality('sub');           // A level ID, 'main', 'sub', or 'auto'
player.getQualityMode();                  // 'auto' or 'manual'
player.setQualityMode('auto');
player.getMaxQualityKind();               // 'main', 'sub', or null
player.setMaxQualityKind('sub');          // Pass null to remove the ceiling

// Timeline, archive coverage and diagnostics
player.getCurrentTime();                  // Media time in seconds
player.getDuration();                     // Infinity for live streams
player.getBufferedEnd();                  // Furthest buffered media position in seconds
player.isBuffering();                     // True while stalled for data
player.getWallClockTime();                // Unix milliseconds, or null
player.seekToWallClock(wallMs);           // True if the loader accepted the seek
player.getCoverage();                     // WallClockRange or null
player.getTelemetry();                    // PlayerTelemetry

// Subscribe and unsubscribe with the same callback
const onQuality = (id: unknown) => console.log('Quality changed:', id);
player.on('qualitychange', onQuality);
player.off('qualitychange', onQuality);

player.destroy();                         // Release workers, decoders, renderer and audio
```

- **Playback.** The lifecycle states are `IDLE`, `LOADING`, `LOADED`, `PLAYING`, `PAUSED` and `DESTROYED`. Live sources ignore seeks. Playback speed snaps to a supported rate. Audio is muted at speeds other than 1× and the user's mute preference is restored at 1×.
- **Quality.** Each `QualityLevel` has `id`, `label`, `url` and `kind`. A loader may also supply `width`, `height`, `fps`, `bitrateKbps` and `codecs`. `getQualityLevels()` returns an empty array when the loader offers no levels. The quality ceiling applies to automatic and manual selection.
- **Archive time.** When a playlist provides `EXT-X-PROGRAM-DATE-TIME`, the player can map media time to wall-clock time. `WallClockRange` contains `startMs`, `endMs` and `gaps`, each gap with its own `startMs` and `endMs`.
- **Events.** Subscribe to `play`, `pause`, `ended`, `error`, `waiting`, `playing`, `qualitychange`, `signals` and `renderfallback`. The `waiting` and `playing` events mark the start and end of buffering.

### Telemetry

`getTelemetry()` returns a `PlayerTelemetry` snapshot. Some fields depend on the active loader or playback diagnostics.

| Fields | Meaning |
|---|---|
| `activeCodec`, `decodingStrategy`, `renderMode` | Video codec, decoder path and renderer. Decoder labels include `WebCodecs (GPU)`, `WASM Fallback` and `ImageBitmap (CPU)`. Renderer modes include `webgl` and `2d-fallback`. |
| `playbackState`, `playbackRate`, `currentPTS`, `duration`, `bufferedEnd` | Playback state, speed and media positions in seconds. |
| `renderedFrames`, `droppedFrames`, `decodedFrames`, `effectiveFps` | Frame counts and effective rendering rate. |
| `queueLength`, `backpressureActive` | Number of queued frames and whether backpressure is active. |
| `throughputKbps`, `qualityMode`, `lastSwitchReason`, `maxAllowedKind` | Smoothed throughput in kilobits per second, ABR mode, reason for the latest switch and the quality ceiling. |
| `connectionState`, `lastError` | Loader-specific connection state and the latest error message, when available. |

`MultiCodecPlayer` is an alias for `YumYumPlayer` for compatibility with existing integrations.

### Codec hints

If an HLS or WebSocket URL needs an explicit decoder hint, use a query parameter. WebSocket URLs cannot contain a fragment. The player recognizes `codec=h265`, `codec=hevc` and `codec=mjpeg`. H.264 is the default.

```text
/live/stream.m3u8?codec=h265
```

The built-in `mock://h264`, `mock://hevc` and `mock://mjpeg` sources select their codec automatically.

## Plugin API

A plugin registers a decoder by codec key or a loader by URL scheme. In this example the application supplies `MyHevcDecoder` and `MyLoader`.

```ts
import { YumYumPlayer, type PlayerPlugin } from '@yumyum-player/core';
import { MyHevcDecoder, MyLoader } from './my-backends.js';

export function myPlugin(): PlayerPlugin {
  return {
    name: 'my-plugin',
    install(ctx) {
      ctx.registerDecoder('h265-sw', (deps) => new MyHevcDecoder(deps));
      ctx.registerLoader(['ws', 'wss'], (deps) => new MyLoader(deps));
    },
  };
}

new YumYumPlayer({ canvas, plugins: [myPlugin()] });
```

Decoder factories receive `onFrame`, `onError` and `logger`. Loader factories receive `LoaderDeps`, including `onData` and `logger`. The plugin itself can log through `ctx.logger`.

- **Decoders.** The core routes `h264`, `h265`, `mjpeg` and `aac`. When native HEVC is unavailable or `forceSoftwareHevc` is set, the HEVC decoder delegates to the registered `h265-sw` decoder.
- **Loaders.** The built-in loader handles HLS, progressive fMP4 and mock streams. `load(url)` selects a registered loader for the URL scheme. Install the corresponding plugin before loading a WebSocket or WHEP URL.

Public contracts include `PlayerPlugin`, `PluginContext`, `DecoderFactory`, `DecoderDeps`, `IBaseDecoder`, `IStreamLoader`, `LoaderFactory`, `LoaderDeps`, `LoaderKind`, `DecodedFrame`, `YUVFrameData`, `Segment`, `Logger` and `LogLevel`.

## Engine plugins

| Package | Use |
|---|---|
| [@yumyum-player/transport-webrtc](../transport-webrtc/README.md) | `transportWebrtc()` adds live WebRTC/WHEP over `whep://` and `whep+https://`. |
| [@yumyum-player/hevc-wasm](../hevc-wasm/README.md) | `hevcWasm()` registers the `h265-sw` software HEVC decoder. See the package instructions for hosting its WASM assets. |
| [@yumyum-player/pro-streaming](../pro-streaming/README.md) | `proStreaming()` installs the `ws://` and `wss://` loader. The package also includes an RTSP-to-MPEG-TS WebSocket server. |

## Browser support

Use HTTPS or localhost for WebCodecs and audio worklets. The core needs a canvas and Web Workers. Native H.264 and HEVC playback depend on `VideoDecoder` support for the stream's codec and profile, which varies by browser and device. The HEVC plugin provides a software decoder. AAC playback can fall back to Web Audio. For audible playback, call `unlockAudio()` from a user gesture if the browser suspends the audio context.

## License

The core is distributed under the [MIT License](./LICENSE).
