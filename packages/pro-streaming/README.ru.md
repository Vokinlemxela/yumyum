[English](./README.md) · **Русский**

# @yumyum-player/pro-streaming

Живой WebSocket-стриминг с низкой задержкой для [Yum-yum Player](../player-sdk/README.ru.md) и локальный сервер перепаковки RTSP в MPEG-TS. WebSocket-транспорт рассчитан на задержку менее 200 мс в подходящих условиях. Итоговая задержка зависит от источника и сети.

```sh
npm install @yumyum-player/core @yumyum-player/pro-streaming
```

## Клиентский плагин

`proStreaming()` регистрирует загрузчик для `ws://` и `wss://`. Загрузчик передаёт непрерывный поток байтов MPEG-TS демуксеру ядра через `STREAM_DEMUX`.

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

## Локальный сервер (`server/ws-server.js`)

Сервер перепаковывает RTSP-поток в MPEG-TS поверх WebSocket через FFmpeg. Он копирует видеопакеты с `-codec:v copy`, корректирует временные метки нестабильных IP-камер и кодирует исходную аудиодорожку в AAC, если она есть.

Запустите сервер из копии репозитория. В примере он слушает адрес loopback и разрешает имя камеры `camera` из примера выше.

```sh
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera npm run serve -w @yumyum-player/pro-streaming
```

Тот же файл можно запустить напрямую из репозитория или из установленного пакета.

```sh
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera node packages/pro-streaming/server/ws-server.js
WS_HOST=127.0.0.1 RTSP_ALLOWED_HOSTS=camera node node_modules/@yumyum-player/pro-streaming/server/ws-server.js
```

Требуются Node.js 18+ и FFmpeg 6+. Сервер ищет FFmpeg в стандартном каталоге Homebrew и в `/usr/local/bin`, затем обращается к `PATH`. `WS_PORT` задаёт порт прослушивания, по умолчанию `3002`. `WS_HOST` задаёт адрес прослушивания.

Если камера, сервер перепаковки и браузер находятся в одной сети, видео остаётся внутри неё. Это позволяет работать в изолированной инфраструктуре.

## Контроль доступа

| Настройка | Поведение |
|---|---|
| `WS_AUTH_TOKEN` | Если задан, сервер требует совпадающий параметр `token` в URL или заголовок `Authorization: Bearer …`. WebSocket-клиент в браузере может передать параметр в URL. При пустой настройке поток может запросить любой клиент, которому доступен порт сервера. |
| `RTSP_ALLOWED_HOSTS` | Список разрешённых имён или IP-адресов RTSP-серверов через запятую. Если список задан, разрешены только его элементы, включая явно указанные внутренние камеры. По умолчанию сервер отклоняет loopback, частные, link-local и multicast IP-адреса, заданные литералами. |

Размещайте сервер перепаковки в доверенной сети за прокси с аутентификацией. Ограничьте исходящие соединения адресами ваших RTSP-источников. FFmpeg разрешает имена самостоятельно, поэтому проверка имени RTSP-сервера дополняет сетевую политику.

## Лицензия

[MIT](./LICENSE).
