**English** · [Русский](https://github.com/Vokinlemxela/yumyum/blob/v1.1.1/packages/pro-streaming/README.ru.md)

# @yumyum-player/pro-streaming

Low-latency live WebSocket streaming for [Yum-yum Player](../player-sdk/README.md), with an on-premises server that repackages RTSP as MPEG-TS. The WebSocket path targets sub-200 ms latency in suitable deployments. End-to-end latency depends on the source and network.

```sh
npm install @yumyum-player/core @yumyum-player/pro-streaming
```

## Client plugin

`proStreaming()` registers a loader for `ws://` and `wss://`. The loader hands the continuous MPEG-TS byte stream to the core demuxer through `STREAM_DEMUX`.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { proStreaming } from '@yumyum-player/pro-streaming';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [proStreaming()],
});

const stream = new URL('ws://127.0.0.1:3002/');
stream.searchParams.set('url', 'rtsp://camera/stream');
await player.load(stream.href);
```

## On-premises server (`server/ws-server.js`)

The server uses FFmpeg to repackage an RTSP stream as MPEG-TS over WebSocket. It copies video packets with `-codec:v copy`, corrects timestamps from unstable IP cameras, and encodes the source audio as AAC when present.

Run the server from a source checkout. This example binds it to loopback and allows the `camera` hostname used above.

```sh
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera npm run serve -w @yumyum-player/pro-streaming
```

You can run the same file directly from the repository or an installed package.

```sh
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera node packages/pro-streaming/server/ws-server.js
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera node node_modules/@yumyum-player/pro-streaming/server/ws-server.js
```

The server requires Node.js 18 or later and FFmpeg 6 or later. It checks the common Homebrew and `/usr/local/bin` locations for FFmpeg before falling back to `PATH`. `WS_PORT` sets the listening port and defaults to `3002`. `WS_HOST` sets the bind address.

With the camera, repackaging server and browser on the same network, video stays within that network. This works for isolated deployments.

## Access controls

| Setting | Behavior |
|---|---|
| `WS_AUTH_TOKEN` | When set, requires a matching `token` query parameter or an `Authorization: Bearer …` header. Browser WebSocket clients can use the query parameter. With an empty setting, any client that can reach the listening port can request a stream. |
| `RTSP_ALLOWED_HOSTS` | Comma-separated list of allowed RTSP hostnames or IP addresses. With a configured list, only those hosts are accepted, including any internal camera you explicitly list. By default, the server rejects loopback, private, link-local and multicast IP literals. |

Keep the repackager on a trusted network behind authenticated ingress. Restrict outbound access to your RTSP sources. FFmpeg resolves hostnames separately, so an RTSP hostname check is only one part of the network policy.

## License

[MIT](./LICENSE).
