**English** · [Русский](./README.ru.md)

# HEVC decoder components

`wasm/hevc.wasm` includes libde265 1.1.3, released by struktur AG under LGPL-3.0-or-later. This directory contains the [complete source archive](./libde265-1.1.3.tar.gz) and the [LGPL](./COPYING.LESSER) and [GPL](./COPYING.GPLv3) license texts. The archive corresponds to tag `v1.1.3` at commit `ba62bf4cfb3242f3bf0a45617ff09e35236e4d82`. [Upstream libde265 sources](https://github.com/strukturag/libde265/tree/ba62bf4cfb3242f3bf0a45617ff09e35236e4d82).

The executable module and its JavaScript loader were built with Emscripten 5.0.7. Notices for [Emscripten](./EMSCRIPTEN-LICENSE), [LLVM](./LLVM-LICENSE), and [musl](./MUSL-COPYRIGHT) are included here. The Player integration is covered by the package's [MIT license](../LICENSE). [HEVC WASM package documentation](../README.md).

To rebuild, install Emscripten, CMake, and Node.js and run the following from the package directory.

```sh
bash native/build.sh
```

To use a modified libde265, pass the path to its sources. The script relinks the decoder and writes both `hevc.js` and `hevc.wasm` to `wasm/`.

```sh
LIBDE265_SOURCE_DIR=/path/to/libde265 bash native/build.sh
```
