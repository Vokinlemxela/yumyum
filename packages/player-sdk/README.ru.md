# @yumyum-player/core

[English](./README.md) · **Русский**

Yum-yum Player — браузерный видеодвижок для прямого эфира и архива. Ядро под лицензией MIT воспроизводит HLS на canvas, извлекает видео и звук из MPEG-TS и фрагментированного MP4 (fMP4) и синхронизирует их. Бесплатные плагины с открытым исходным кодом добавляют программное декодирование HEVC, потоки WebSocket и WebRTC/WHEP. [Плагины движка](#плагины-движка)

## Установка

```bash
npm install @yumyum-player/core
```

Web Worker для демультиплексирования и аудиопроцессор PCM встроены в пакет как исходный код для Blob. Оба компонента входят в поставку ядра.

## Быстрый старт

Добавьте на страницу `<canvas></canvas>`, загрузите плейлист и запустите воспроизведение.

```ts
import { YumYumPlayer } from '@yumyum-player/core';

const canvas = document.querySelector('canvas')!;
const player = new YumYumPlayer({ canvas });

await player.load('https://example.com/stream.m3u8');
await player.play();
```

Чтобы запустить пример без медиасервера, замените адрес плейлиста на `mock://h264`, `mock://hevc` или `mock://mjpeg`.

## Возможности ядра

| Область | Поддержка |
|---|---|
| Видео | H.264/AVC и HEVC/H.265 через браузерные декодеры WebCodecs. Кадры MJPEG декодируются через `createImageBitmap`. |
| Аудио | AAC через `AudioDecoder` в виде отдельных кадров или в формате ADTS. Если нативный декодер AAC недоступен, плеер пробует Web Audio `decodeAudioData`. За вывод PCM отвечает `AudioWorklet`. |
| Источники | HLS с сегментами MPEG-TS или fMP4, постепенно загружаемый фрагментированный MP4 и встроенные потоки `mock://`. Демультиплексор извлекает единицы доступа видео и кадры AAC. |
| Отрисовка | WebGL2 с поддержкой YUV. Доступна резервная отрисовка через Canvas 2D. |
| Синхронизация | При наличии звука часы воспроизведения могут опираться на аудиочасы. |
| Восстановление | Плеер восстанавливает декодер после ошибки или смены профиля, регулирует подачу кадров при заполнении очереди, проверяет синхробайт MPEG-TS и возвращается к прямому эфиру при отставании. |

## Конфигурация

Обязателен только `canvas`. Пример ограничивает обработку и отрисовку видео до 8 кадров в секунду для ячейки видеосетки. Для обычного воспроизведения эти параметры можно опустить. Предустановка `lowPower` по умолчанию задаёт оба ограничения на уровне 8 кадров в секунду и уменьшает очередь кадров.

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

- **Воспроизведение.** Состояния жизненного цикла — `IDLE`, `LOADING`, `LOADED`, `PLAYING`, `PAUSED` и `DESTROYED`. Прямые трансляции игнорируют перемотку. Плеер выбирает ближайшую поддерживаемую скорость. На скорости, отличной от 1×, он отключает звук, а при возврате к 1× восстанавливает выбранный пользователем режим.
- **Качество.** Каждый `QualityLevel` содержит `id`, `label`, `url` и `kind`. Загрузчик также может предоставить `width`, `height`, `fps`, `bitrateKbps` и `codecs`. Если уровни отсутствуют, `getQualityLevels()` возвращает пустой массив. Ограничение верхнего уровня качества действует и при автоматическом, и при ручном выборе.
- **Время в архиве.** При наличии `EXT-X-PROGRAM-DATE-TIME` в плейлисте плеер может сопоставлять позицию воспроизведения с календарным временем. `WallClockRange` содержит `startMs`, `endMs` и массив разрывов `gaps`, у каждого разрыва есть свои `startMs` и `endMs`.
- **События.** Доступны `play`, `pause`, `ended`, `error`, `waiting`, `playing`, `qualitychange`, `signals` и `renderfallback`. События `waiting` и `playing` обозначают начало и конец буферизации.

### Телеметрия

`getTelemetry()` возвращает снимок `PlayerTelemetry`. Доступность некоторых полей зависит от загрузчика и диагностики воспроизведения.

| Поля | Значение |
|---|---|
| `activeCodec`, `decodingStrategy`, `renderMode` | Кодек, способ декодирования и режим отрисовки. Среди значений стратегии — `WebCodecs (GPU)`, `WASM Fallback` и `ImageBitmap (CPU)`. Примеры режимов отрисовки — `webgl` и `2d-fallback`. |
| `playbackState`, `playbackRate`, `currentPTS`, `duration`, `bufferedEnd` | Состояние, скорость и позиции на шкале времени в секундах. |
| `renderedFrames`, `droppedFrames`, `decodedFrames`, `effectiveFps` | Число отрисованных, пропущенных и декодированных кадров, фактическая частота отрисовки. |
| `queueLength`, `backpressureActive` | Длина очереди кадров и признак ограничения подачи новых кадров. |
| `throughputKbps`, `qualityMode`, `lastSwitchReason`, `maxAllowedKind` | Сглаженная пропускная способность в кбит/с, режим адаптивного выбора качества, причина последнего переключения и допустимый верхний уровень. |
| `connectionState`, `lastError` | Состояние подключения, которое сообщает загрузчик, и последнее сообщение об ошибке, если оно есть. |

Для совместимости с существующими интеграциями `YumYumPlayer` также экспортируется под именем `MultiCodecPlayer`.

### Подсказки кодека

Если для HLS- или WebSocket-адреса нужно указать декодер, передайте подсказку в параметре запроса. WebSocket-адреса не допускают фрагмента после `#`. Плеер распознаёт `codec=h265`, `codec=hevc` и `codec=mjpeg`. По умолчанию выбирается H.264.

```text
/live/stream.m3u8?codec=h265
```

Встроенные источники `mock://h264`, `mock://hevc` и `mock://mjpeg` выбирают кодек автоматически.

## API плагинов

Плагин регистрирует декодер по ключу кодека или загрузчик по схеме URL. В этом примере приложение предоставляет классы `MyHevcDecoder` и `MyLoader`.

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

Фабрики декодеров получают `onFrame`, `onError` и `logger`. Фабрики загрузчиков получают `LoaderDeps`, включая `onData` и `logger`. Самому плагину доступен журнал `ctx.logger`.

- **Декодеры.** Ядро направляет данные в декодеры `h264`, `h265`, `mjpeg` и `aac`. При отсутствии нативного HEVC или включённом `forceSoftwareHevc` обработка HEVC передаётся зарегистрированному декодеру `h265-sw`.
- **Загрузчики.** Встроенный загрузчик обслуживает HLS, постепенно загружаемый fMP4 и тестовые потоки. Метод `load(url)` выбирает зарегистрированный загрузчик по схеме адреса. Перед загрузкой WebSocket- или WHEP-потока подключите соответствующий плагин.

Публичные контракты включают `PlayerPlugin`, `PluginContext`, `DecoderFactory`, `DecoderDeps`, `IBaseDecoder`, `IStreamLoader`, `LoaderFactory`, `LoaderDeps`, `LoaderKind`, `DecodedFrame`, `YUVFrameData`, `Segment`, `Logger` и `LogLevel`.

## Плагины движка

| Пакет | Назначение |
|---|---|
| [@yumyum-player/transport-webrtc](../transport-webrtc/README.ru.md) | `transportWebrtc()` добавляет прямой эфир WebRTC/WHEP по схемам `whep://` и `whep+https://`. |
| [@yumyum-player/hevc-wasm](../hevc-wasm/README.ru.md) | `hevcWasm()` регистрирует программный декодер HEVC под ключом `h265-sw`. В документации пакета описано размещение файлов WASM. |
| [@yumyum-player/pro-streaming](../pro-streaming/README.ru.md) | `proStreaming()` подключает загрузчик для `ws://` и `wss://`. Пакет также содержит сервер для передачи RTSP-потока через WebSocket в формате MPEG-TS. |

## Поддержка браузеров

Для WebCodecs и аудиопроцессоров используйте HTTPS или localhost. Ядру нужны canvas и Web Workers. Для нативного воспроизведения H.264 и HEVC декодер `VideoDecoder` должен поддерживать кодек и профиль потока. Поддержка зависит от браузера и устройства. Плагин HEVC предоставляет программный декодер, а для AAC предусмотрен резервный путь через Web Audio. Если браузер приостановил аудиоконтекст, вызовите `unlockAudio()` в обработчике действия пользователя.

## Лицензия

Ядро распространяется по [лицензии MIT](./LICENSE).
