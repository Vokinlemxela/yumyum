# @yumyum-player/hevc-wasm

Универсальный **программный декодер HEVC / H.265** для [Yum-yum Player](../player-sdk).
Проигрывает HEVC даже там, где у браузера **нет нативной поддержки** (Firefox,
Linux, Chrome без аппаратного HEVC, старые устройства) — декодируя в WebAssembly.

Установка: `npm install @yumyum-player/core @yumyum-player/hevc-wasm`.

## Как подключается

Бесплатное ядро поставляет нативный HEVC (где браузер его поддерживает). Когда
нативный HEVC недоступен, `HEVCDecoder` ядра делегирует декодеру,
зарегистрированному под ключом `h265-sw`. Этот пакет регистрирует именно его —
через plugin-шов, без форков и правок ядра:

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';

const player = new YumYumPlayer({
  canvas,
  plugins: [hevcWasm()],
});
```

## Интерфейс бэкенда

Пакет связывает программный декодер с плеером:

- плагин `hevcWasm()` и регистрацию `h265-sw`,
- `WasmHevcDecoder`: жизненный цикл, ограниченную очередь NAL на прогрев модуля,
  доставку кадров в плеер.

Сам **кодек** — заменяемый `HevcWasmBackend` (см. `backend.ts`):

```ts
interface HevcWasmBackend {
  init(): Promise<void>;
  decode(accessUnit: Uint8Array, pts: number): RgbaFrame | null;
  reset(): void;
  destroy(): void;
}
```

## WASM-бинарь (libde265)

Бэкенд по умолчанию `createLibde265Backend()` использует сборку
**libde265 1.1.3** (`wasm/hevc.{js,wasm}`), собранную `native/build.sh` (Emscripten).
Это **однопоточная** сборка (без `-pthread`, фиксированная память
`ALLOW_MEMORY_GROWTH=0`, `STACK_SIZE=8MB`) — выбрана ради стабильности после
повреждения кучи при pthread + memory-growth во вложенных воркерах. Декодирование
всё равно идёт **вне главного потока**, потому что режим воркера плагина
(`workerUrl`) запускает весь кодек в Web Worker, сохраняя плавность UI.

Если приложение использует сборщик, разместите `wasm/hevc.js`, `wasm/hevc.wasm`
и `worker/decode-worker.js` из установленного пакета среди статических файлов.
Оставьте `hevc.js` и `hevc.wasm` в одном каталоге и передайте пути в плагин:

```ts
hevcWasm({ glueUrl: '/hevc/hevc.js', workerUrl: '/hevc/decode-worker.js' });
```

### Cross-origin isolation НЕ требуется

Однопоточная сборка не использует `SharedArrayBuffer`, поэтому странице **не**
нужна cross-origin isolation — заголовки COOP/COEP для HEVC-WASM не требуются.

> Опция `threads` / `hardwareConcurrency` у `hevcWasm()` и
> `createLibde265Backend()` сейчас не изменяет число потоков.

### Статус

HEVC по **HLS работает** (загруженные файлы и RTSP→HLS). **Путь WS низкой
задержки** с некоторыми сырыми потоками IP-камер пока не полностью декодируется
встроенной сборкой libde265 (выходят только IDR-кадры).

### Пересборка бинаря

```bash
npm run wasm -w @yumyum-player/hevc-wasm
```
Требуются `emcc` + `cmake` в PATH (`brew install cmake emscripten`).

### Свой бэкенд

`HevcWasmBackend` заменяем, поэтому другой кодек-модуль можно подставить через
`hevcWasm({ backend })` без изменения связки плагина.

## Лицензии

Код интеграции с Player распространяется по [MIT](./LICENSE).
Сборка [libde265](https://github.com/strukturag/libde265) распространяется по
LGPL-3.0-or-later. Исходники и тексты лицензий этой сборки входят в каталог
[`third-party`](./third-party).
