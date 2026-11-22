[English](./README.md) · **Русский**

# Компоненты HEVC-декодера

В `wasm/hevc.wasm` входит libde265 версии 1.1.3, выпущенная struktur AG под LGPL-3.0-or-later. В каталоге находятся [полный архив исходников](./libde265-1.1.3.tar.gz) и тексты [LGPL](./COPYING.LESSER) и [GPL](./COPYING.GPLv3). Архив соответствует тегу `v1.1.3`, коммит `ba62bf4cfb3242f3bf0a45617ff09e35236e4d82`. [Исходники libde265](https://github.com/strukturag/libde265/tree/ba62bf4cfb3242f3bf0a45617ff09e35236e4d82).

Исполняемый модуль и его загрузчик JavaScript собраны Emscripten 5.0.7. В каталоге приложены уведомления [Emscripten](./EMSCRIPTEN-LICENSE), [LLVM](./LLVM-LICENSE) и [musl](./MUSL-COPYRIGHT). Интеграция с Player распространяется по [лицензии MIT](../LICENSE). [Документация пакета HEVC WASM](../README.ru.md).

Для повторной сборки установите Emscripten, CMake и Node.js и выполните из каталога пакета следующую команду.

```sh
bash native/build.sh
```

Чтобы использовать модифицированную libde265, передайте путь к её исходникам. Скрипт перелинкует декодер и запишет `hevc.js` и `hevc.wasm` в `wasm/`.

```sh
LIBDE265_SOURCE_DIR=/path/to/libde265 bash native/build.sh
```
