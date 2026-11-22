[English](./README.md) · **Русский**

# @yumyum-player/transport-webrtc

Низколатентный транспорт WebRTC/WHEP для [Yum-yum Player](../player-sdk/README.ru.md). Получает закодированное видео через Encoded Transform и передаёт его в конвейер WebCodecs и WebGL плеера.

```sh
npm install @yumyum-player/core @yumyum-player/transport-webrtc
```

## Подключение

Создайте элемент `<canvas id="player">` и передайте плееру адрес WHEP-эндпоинта, например MediaMTX.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { transportWebrtc } from '@yumyum-player/transport-webrtc';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [transportWebrtc()],
});

await player.load('whep://localhost:8889/camera/whep');
```

## Схемы URL

| Схема | Транспорт запроса | Применение |
|---|---|---|
| `whep://host/path` | HTTP | Локальная разработка |
| `whep+https://host/path` | HTTPS | Соединение с TLS |

Плагин преобразует схему URL перед отправкой WHEP-запроса. Если эндпоинт находится на другом источнике, разрешите CORS для источника приложения и откройте доступ к заголовку ответа `Location`, чтобы загрузчик мог завершить удалённую сессию.

## Передача данных

```text
WHEPLoader ── POST с SDP offer ──► WHEP-эндпоинт
           ◄──── SDP answer ──────

Видеодорожка → Encoded Transform → onMockPacket → WebCodecs → WebGL canvas
Аудиодорожка → MediaStream       → AudioContext             → вывод звука
```

1. Загрузчик отправляет SDP offer HTTP-запросом POST к WHEP-эндпоинту и применяет полученный SDP answer к соединению.
2. Закодированные видеокадры поступают в плеер через `onMockPacket` напрямую в декодер.
3. Браузер декодирует звук и воспроизводит его через `MediaStream` и `AudioContext`.
4. Если сервер вернул URL сессии в заголовке `Location`, при закрытии соединения загрузчик отправляет на этот URL запрос `DELETE`. При сбое ICE-соединения загрузчик может переподключиться.

## Параметры

```ts
transportWebrtc({
  connectTimeoutMs: 10_000,
  extraHeaders: { Authorization: 'Bearer YOUR_TOKEN' },
  rtcConfig: {
    iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  },
});
```

| Параметр | Назначение |
|---|---|
| `connectTimeoutMs` | Таймаут HTTP-запроса POST к WHEP-эндпоинту. По умолчанию 10 секунд. |
| `extraHeaders` | Дополнительные заголовки WHEP-запросов `POST` и `DELETE`, в том числе для авторизации на эндпоинте. |
| `rtcConfig` | Переопределяет `RTCConfiguration`, включая ICE-серверы и политику транспорта. STUN-сервер по умолчанию — `stun:stun.l.google.com:19302`. |

## Требования к браузеру

Используйте браузер с WebRTC, WebCodecs и поддержкой Encoded Transform для видео. Экспортируемая функция `detectEncodedTransformSupport()` возвращает `script-transform` при наличии `RTCRtpScriptTransform`, `encoded-streams` при наличии `RTCRtpReceiver.prototype.createEncodedStreams` или `null`, если оба API недоступны. Загрузчик использует `createEncodedStreams()`, когда этот метод есть у получателя. В режиме `RTCRtpScriptTransform` загрузчик создаёт модульный воркер по Blob URL, который должна разрешать политика CSP страницы.

## Поддержка кодеков

| Кодек | Требования |
|---|---|
| H.264 | Декодер плеера по умолчанию. Браузер и сервер должны согласовать и поддерживать профиль H.264. |
| H.265 (HEVC) | Браузер и WHEP-сервер должны согласовать HEVC. Для источника HEVC добавьте к WHEP URL параметр `?codec=h265`, чтобы Player выбрал декодер HEVC. |

## Ошибки и переподключение

Плагин сообщает об ошибках через событие плеера `error`. Для подписки используйте `player.on('error', handler)`. Например, ошибка возникает при отсутствии Encoded Transform или ответе WHEP-эндпоинта с кодом 4xx или 5xx.

После потери установленного ICE-соединения попытки переподключения продолжаются, пока приложение не закроет транспорт. Задержка между попытками растёт экспоненциально, с верхним пределом и случайной добавкой. Для перехода на HLS обработайте ошибку в приложении и загрузите HLS-источник.

## Лицензия

[MIT](./LICENSE).
