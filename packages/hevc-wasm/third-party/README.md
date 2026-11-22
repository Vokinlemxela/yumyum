# Компоненты HEVC-декодера

В `wasm/hevc.wasm` входит libde265 версии 1.1.3, выпущенная struktur AG под LGPL-3.0-or-later. В каталоге находятся полные исходники этой версии и тексты LGPL и GPL. Архив соответствует тегу `v1.1.3`, коммит `ba62bf4cfb3242f3bf0a45617ff09e35236e4d82`. [Исходники libde265](https://github.com/strukturag/libde265/tree/ba62bf4cfb3242f3bf0a45617ff09e35236e4d82)

Исполняемый модуль и загрузчик собраны Emscripten 5.0.7. Уведомления Emscripten, LLVM и musl приложены рядом. Обвязка Player распространяется под лицензией MIT из корня пакета.

Для повторной сборки установите Emscripten, CMake и Node.js и выполните из каталога пакета:

```sh
bash native/build.sh
```

Чтобы использовать модифицированную библиотеку, передайте путь к её исходникам. Скрипт перелинкует декодер и запишет оба файла в `wasm/`.

```sh
LIBDE265_SOURCE_DIR=/path/to/libde265 bash native/build.sh
```
