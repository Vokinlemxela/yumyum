# @yumyum-player/transport-webrtc

Низколатентный транспорт WebRTC/WHEP для [Yum-yum Player](../../README.md).
Получает закодированное видео через **Encoded Transform** и передаёт его
конвейеру WebCodecs и WebGL.

Установка: `npm install @yumyum-player/core @yumyum-player/transport-webrtc`.

## Подключение

```typescript
import { YumYumPlayer } from '@yumyum-player/core';
import { transportWebrtc } from '@yumyum-player/transport-webrtc';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [transportWebrtc()],
});

// The plugin converts the WHEP URL into an HTTP POST request.
await player.load('whep://localhost:8889/camera/whep');
```

## Схемы URL

| Схема | Транспорт | Назначение |
|--------|-----------|-------------|
| `whep://host/path` | HTTP | Локальная разработка |
| `whep+https://host/path` | HTTPS | Соединение с TLS |

## Передача данных

```
┌─────────────┐     POST SDP      ┌──────────────┐
│  WHEPLoader │ ──────────────► │ WHEP Endpoint │
│             │ ◄────────────── │  (MediaMTX)   │
│             │     SDP Answer    └──────────────┘
│             │
│  ontrack ───┼─► Encoded Transform ─► onMockPacket ─► WebCodecs Decoder ─► WebGL
│  (video)    │   (insertable streams)                                      Canvas
│             │
│  ontrack ───┼─► MediaStream ─► AudioContext ─► Speakers
│  (audio)    │   (native decode)
└─────────────┘
```

1. Плагин отправляет SDP offer запросом POST к WHEP-эндпоинту и получает SDP answer.
2. Видео передаётся из Encoded Transform в WebCodecs через `onMockPacket`.
3. Аудио воспроизводится через `MediaStream` и `AudioContext`.
4. После потери ICE-соединения плагин переподключается с экспоненциальной задержкой.

## Параметры

```typescript
transportWebrtc({
  connectTimeoutMs: 10_000,         // Default: 10s
  extraHeaders: {                   // Custom HTTP headers for WHEP requests
    'Authorization': 'Bearer token',
  },
  rtcConfig: {                      // RTCConfiguration override
    iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  },
});
```

## Поддержка браузеров

| API | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Encoded Transform (`createEncodedStreams`) | 86+ | 86+ | ✗ | ✗ |
| `RTCRtpScriptTransform` | 110+ | 110+ | 117+ | 15.4+ |

Плагин автоматически выбирает доступный API.

## Поддержка кодеков

| Кодек | Поддержка |
|-------|--------|
| **H.264** | По умолчанию для WHEP и WebRTC |
| **H.265 (HEVC)** | Ограничена возможностями браузера и сервера |

## Ошибки и переподключение

Плагин сообщает об ошибках через событие плеера `on('error', …)`.
Примеры сообщений:

- `Browser does not support Encoded Transform`
- `WHEP endpoint returned 4xx/5xx`

После потери ICE-соединения попытки продолжаются до закрытия сессии.
Между попытками действует экспоненциальная задержка с верхним пределом и
случайной добавкой. Приложение может обработать ошибку и переключиться на HLS.

## Лицензия

[MIT](./LICENSE).
