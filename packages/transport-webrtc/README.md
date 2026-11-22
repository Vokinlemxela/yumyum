**English** · [Русский](https://github.com/Vokinlemxela/yumyum/blob/v1.1.1/packages/transport-webrtc/README.ru.md)

# @yumyum-player/transport-webrtc

Low-latency WebRTC/WHEP transport for [Yum-yum Player](../player-sdk/README.md). It receives encoded video through Encoded Transform and sends it through the player's WebCodecs and WebGL pipeline.

```sh
npm install @yumyum-player/core @yumyum-player/transport-webrtc
```

## Getting started

Create a `<canvas id="player">` element and point the player at a WHEP endpoint such as MediaMTX.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { transportWebrtc } from '@yumyum-player/transport-webrtc';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [transportWebrtc()],
});

await player.load('whep://localhost:8889/camera/whep');
```

## URL schemes

| Scheme | Endpoint transport | Typical use |
|---|---|---|
| `whep://host/path` | HTTP | Local development |
| `whep+https://host/path` | HTTPS | Connection over TLS |

The plugin converts the URL scheme before sending the WHEP request. For a cross-origin endpoint, enable CORS for your application's origin and expose the `Location` response header so the loader can close the remote session.

## Data flow

```text
WHEPLoader ── POST SDP offer ──► WHEP endpoint
           ◄── SDP answer ──────

Video track → Encoded Transform → onMockPacket → WebCodecs → WebGL canvas
Audio track → MediaStream       → AudioContext             → audio output
```

1. The loader sends the SDP offer to the WHEP endpoint using HTTP POST and applies the SDP answer to the peer connection.
2. Encoded video frames enter the player through `onMockPacket` and go directly to the decoder.
3. The browser decodes audio and plays it through `MediaStream` and `AudioContext`.
4. When the server provides a session URL in `Location`, the loader sends `DELETE` to that URL when the connection closes. The loader can reconnect after an ICE connection failure.

## Options

```ts
transportWebrtc({
  connectTimeoutMs: 10_000,
  extraHeaders: { Authorization: 'Bearer YOUR_TOKEN' },
  rtcConfig: {
    iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  },
});
```

| Option | Purpose |
|---|---|
| `connectTimeoutMs` | Timeout for the HTTP POST to the WHEP endpoint. The default is 10 seconds. |
| `extraHeaders` | Additional headers for WHEP `POST` and `DELETE` requests, including endpoint authentication. |
| `rtcConfig` | Overrides `RTCConfiguration`, including ICE servers and transport policy. The default STUN server is `stun:stun.l.google.com:19302`. |

## Browser requirements

Use a browser with WebRTC, WebCodecs and support for encoded video transforms. The exported `detectEncodedTransformSupport()` returns `script-transform` when `RTCRtpScriptTransform` is available, `encoded-streams` when `RTCRtpReceiver.prototype.createEncodedStreams` is available, or `null` otherwise. The loader uses `createEncodedStreams()` when the receiver provides it. The script-transform path creates a module worker from a Blob URL, which the page's Content Security Policy must permit.

## Codec support

| Codec | Requirements |
|---|---|
| H.264 | The player's default decoder. The browser and server must negotiate and support the H.264 profile. |
| H.265 (HEVC) | The browser and WHEP server must negotiate HEVC. For an HEVC source, add `?codec=h265` to the WHEP URL to select the HEVC decoder in Player. |

## Errors and reconnection

The plugin reports errors through the player's `error` event, which you can subscribe to with `player.on('error', handler)`. For example, the browser may lack Encoded Transform, or the WHEP endpoint may return a 4xx or 5xx status.

After an established connection loses ICE, reconnection attempts continue until the application closes the transport. The loader uses capped exponential backoff with jitter. To fall back to HLS, handle the error in your application and load the HLS source.

## License

[MIT](./LICENSE).
