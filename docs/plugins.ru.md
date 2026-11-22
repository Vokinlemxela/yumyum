# Подключение модулей Yum-yum Player

Ядро воспроизводит HLS и использует нативное декодирование браузера. Три бесплатных модуля добавляют программное декодирование HEVC, WebSocket и WebRTC/WHEP. Установите ядро и пакеты, которые нужны приложению.

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

Разместите `worker/decode-worker.js`, `wasm/hevc.js` и `wasm/hevc.wasm` из npm-пакета в каталоге `/hevc/` вашего сайта. Передайте пути к worker и `hevc.js` в `hevcWasm()`, как в примере. Ядро использует этот декодер, когда браузер не поддерживает нативный HEVC. Для принудительного выбора задайте `forceSoftwareHevc: true` в настройках плеера.

Поставляемая сборка libde265 выполняет декодирование в одном потоке. Worker выносит вычисления из основного потока интерфейса. Для текущей сборки достаточно обычных условий загрузки Worker и WebAssembly. Лицензия libde265 и порядок сборки описаны в документации пакета. [HEVC WASM](../packages/hevc-wasm/README.ru.md).

## WebSocket

`proStreaming()` регистрирует `ws://` и `wss://`. В монорепозитории RTSP-сервер запускается командой ниже. Требуются Node.js и FFmpeg в `PATH`.

```sh
WS_PORT=3002 npm run serve -w @yumyum-player/pro-streaming
```

Сервер перепаковывает видео из RTSP в MPEG-TS без перекодирования. В URL плеера передайте адрес камеры как query-параметр `url`.

```ts
const stream = new URL('ws://localhost:3002/');
stream.searchParams.set('url', 'rtsp://camera.local/stream');
stream.searchParams.set('codec', 'h265');
await player.load(stream.href);
```

Доступ к серверу контролируйте через сетевую конфигурацию и авторизованный вход. Сервер принимает RTSP-адрес от клиента и использует его как источник. [Настройка WebSocket](../packages/pro-streaming/README.ru.md).

## WebRTC/WHEP

`transportWebrtc()` подключается к совместимому WHEP-серверу, например MediaMTX. Схема `whep+https://` соответствует HTTPS, а `whep://` — HTTP. Для передачи кадров в WebCodecs браузер должен поддерживать Encoded Transform. При необходимости задайте ICE-серверы в `rtcConfig` и заголовки авторизации источника в `extraHeaders`. [Настройка WebRTC/WHEP](../packages/transport-webrtc/README.md).
