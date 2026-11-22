[English](./README.md) · **Русский**

# @yumyum-player/hevc-wasm

Программный декодер HEVC/H.265 для [Yum-yum Player](../player-sdk/README.ru.md). Декодирует HEVC в WebAssembly на устройствах и в браузерах без нативного декодирования HEVC.

```sh
npm install @yumyum-player/core @yumyum-player/hevc-wasm
```

## Подключение

`hevcWasm()` регистрирует программный декодер под именем `h265-sw`. Ядро выбирает его при отсутствии нативного декодирования HEVC или если передать плееру `forceSoftwareHevc: true`.

В веб-приложении со сборщиком скопируйте `wasm/hevc.js`, `wasm/hevc.wasm` и `worker/decode-worker.js` из установленного пакета в публичный каталог. Оставьте `hevc.js` и `hevc.wasm` в одном каталоге. Создайте элемент `<canvas id="player">` и передайте плагину соответствующие URL файлов.

```ts
import { YumYumPlayer } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';

const player = new YumYumPlayer({
  canvas: document.getElementById('player') as HTMLCanvasElement,
  plugins: [
    hevcWasm({ glueUrl: '/hevc/hevc.js', workerUrl: '/hevc/decode-worker.js' }),
  ],
});
```

Если среда исполнения может разрешить пути к WASM-файлам пакета напрямую, `hevcWasm()` без аргументов загружает поставляемый декодер в главном потоке.

## Интерфейс бэкенда

Плагин подключается к Player, регистрируя `h265-sw`. `WasmHevcDecoder` управляет жизненным циклом декодера, ограничивает очередь NAL во время инициализации и передаёт кадры плееру. `HevcWasmBackend` задаёт интерфейс заменяемой реализации кодека. [Типы бэкенда](./src/backend.ts).

```ts
interface RgbaFrame {
  width: number;
  height: number;
  pts: number;
  data: Uint8Array;
}

interface HevcWasmBackend {
  init(): Promise<void>;
  decode(accessUnit: Uint8Array, pts: number): RgbaFrame | null;
  reset(): void;
  destroy(): void;
}
```

`decode()` принимает одну единицу доступа Annex B со стартовыми кодами и метку времени показа в микросекундах. Он возвращает кадр в упакованном формате RGBA в порядке показа или `null`, пока декодеру нужны дополнительные данные. У возвращённого кадра собственная метка времени показа в микросекундах.

## WASM-бинарь (libde265)

Бэкенд по умолчанию `createLibde265Backend()` использует **libde265 1.1.3**. Скрипт `native/build.sh` собирает `wasm/hevc.js` и `wasm/hevc.wasm` через Emscripten. Поставляемая сборка однопоточная, с фиксированной памятью 256 МиБ (`ALLOW_MEMORY_GROWTH=0`) и стеком 8 МиБ. Такая конфигурация устраняет повреждение кучи, наблюдавшееся при одновременном использовании pthreads и роста памяти во вложенных воркерах. При передаче `workerUrl` и `glueUrl` декодирование выполняется в отдельном Web Worker и освобождает главный поток для интерфейса.

### Изоляция страницы и потоки декодирования

Поставляемая сборка использует обычную память WebAssembly и работает без `SharedArrayBuffer` и заголовков COOP/COEP. Опция `threads` и значение `hardwareConcurrency` браузера не меняют число потоков этой сборки.

### Состояние воспроизведения

Бэкенд libde265 поддерживает HEVC через HLS из загруженных файлов и при перепаковке RTSP в HLS. На некоторых сырых потоках IP-камер при передаче по низколатентному WebSocket встроенный декодер выдаёт только IDR-кадры.

### Пересборка бинаря

Установите Emscripten, CMake и Node.js. В macOS Emscripten и CMake можно установить через Homebrew.

```sh
brew install cmake emscripten
```

Запустите сборку из корня репозитория.

```sh
npm run wasm -w @yumyum-player/hevc-wasm
```

### Свой бэкенд

Передайте свою реализацию `HevcWasmBackend` через `hevcWasm({ backend })`. Она заменит режим воркера и будет работать в главном потоке.

## Лицензии

Код интеграции с Player распространяется по [MIT](./LICENSE). Включённая сборка [libde265](https://github.com/strukturag/libde265) распространяется по LGPL-3.0-or-later. Пакет содержит архив исходников и тексты лицензий. [Сторонние компоненты](./third-party/README.ru.md).
