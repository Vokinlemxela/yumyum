# Yum-yum Player

[English](./README.md) · Русский

Открытый браузерный видеодвижок для HLS, WebRTC/WHEP и WebSocket. Движок
декодирует видео через WebCodecs и выводит кадры в canvas через WebGL2.
Все пакеты доступны бесплатно.

| Пакет | Возможности |
| --- | --- |
| [`@yumyum-player/core`](./packages/player-sdk/README.ru.md) | HLS (MPEG-TS и fMP4), H.264, нативный HEVC, MJPEG, AAC, A/V-синхронизация |
| [`@yumyum-player/transport-webrtc`](./packages/transport-webrtc/README.ru.md) | Прямой эфир через WebRTC/WHEP |
| [`@yumyum-player/pro-streaming`](./packages/pro-streaming/README.ru.md) | WebSocket-транспорт и сервер перепаковки RTSP в MPEG-TS через FFmpeg |
| [`@yumyum-player/hevc-wasm`](./packages/hevc-wasm/README.ru.md) | Программное декодирование HEVC через WebAssembly и libde265 |

Web-интерфейс плеера на React доступен в отдельном пакете
[`@yumyum-player/ui`](https://www.npmjs.com/package/@yumyum-player/ui).

## Подключение

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

Чтобы попробовать без потокового сервера, используйте `mock://h264`.
Примеры подключения плагинов приведены в документации каждого пакета.

## Сборка

Требуются Node.js 22.12 или новее и npm 11. Для сервера RTSP и утилиты подготовки HLS нужен
FFmpeg в PATH. Команда `npm run package` запускает исходную утилиту
[`hls-packager`](./packages/hls-packager).

```bash
npm ci
npm run build
npm run typecheck
npm test
```

## Примеры и диагностика

[Руководство по модулям](docs/plugins.ru.md) показывает, как подключить WHEP, WebSocket и программный декодер HEVC. Для проверки локальных потоков соберите пакеты, затем запустите `npm run dev:debugger` и откройте `http://127.0.0.1:3003`. Отладчик использует FFmpeg для обработки RTSP и загруженных файлов.

## Лицензии

Исходный код Player распространяется по [MIT](./LICENSE).
Декодер libde265 распространяется по LGPL-3.0-or-later. Его исходники и тексты
лицензий идут вместе с [HEVC-пакетом](./packages/hevc-wasm/third-party/README.ru.md).

[История изменений](./CHANGELOG.ru.md)
