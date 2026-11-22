# @yumyum-player/pro-streaming

Живой **WebSocket-стриминг сверхнизкой задержки** (суб-200мс) для
[Yum-yum Player](../player-sdk), плюс **on-prem сервер перепаковки RTSP→MPEG-TS**.

Установка: `npm install @yumyum-player/core @yumyum-player/pro-streaming`.

## Клиентский плагин

Плагин регистрирует WebSocket-загрузчик для схем `ws://` и `wss://`.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { proStreaming } from '@yumyum-player/pro-streaming';

const player = new YumYumPlayer({
  canvas,
  plugins: [proStreaming()],
});
await player.load('ws://localhost:3002/?url=rtsp://camera/stream');
```

Загрузчик принимает непрерывный поток байтов MPEG-TS и передаёт его демуксеру
ядра (`STREAM_DEMUX`).

## On-prem сервер (`server/ws-server.js`)

Перепаковывает RTSP-поток камеры в MPEG-TS поверх WebSocket через FFmpeg
(`-codec:v copy`, без перекодирования) с коррекцией таймстемпов для нестабильных
IP-камер.

```bash
WS_PORT=3002 npm run serve -w @yumyum-player/pro-streaming
# или: node packages/pro-streaming/server/ws-server.js
```

По умолчанию сервер слушает порт 3002. Его можно изменить переменной
`WS_PORT`. Чтобы ограничить адрес прослушивания, задайте `WS_HOST`.
Требуются Node.js 18+ и FFmpeg 6+ в PATH.

Важно: сервер работает **внутри сети самого заказчика** — камера, перепаковщик и
браузер находятся на одном периметре, поэтому трафик его не покидает. Это делает
его пригодным для закрытых / air-gapped развёртываний, где маршрутизация видео
через внешнее облако запрещена.

## Замечание по безопасности

Сервер не выполняет аутентификацию и принимает любой `rtsp://`-адрес — он
рассчитан на работу в доверенной внутренней сети, за собственным
auth/ingress заказчика. Не выставляйте его напрямую в публичный интернет.

## Лицензия

[MIT](./LICENSE).
