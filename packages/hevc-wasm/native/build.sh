#!/usr/bin/env bash
#
# Build libde265 -> WebAssembly and link the C wrapper into wasm/hevc.{js,wasm}.
# Requires Emscripten (emcc/emcmake) and cmake on PATH.
#
#   brew install cmake emscripten   # macOS
#   bash native/build.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
BUILD=$(mktemp -d "${TMPDIR:-/tmp}/yumyum-hevc.XXXXXXXX")
trap 'rm -rf "$BUILD"' EXIT
OUT="$PKG/wasm"
mkdir -p "$OUT"

# The bundled sources match the shipped decoder. To relink against a modified
# libde265 checkout, point LIBDE265_SOURCE_DIR at that directory.
SRC=${LIBDE265_SOURCE_DIR:-}
if [ -z "$SRC" ]; then
  ARCHIVE="$PKG/third-party/libde265-1.1.3.tar.gz"
  node -e 'const fs=require("node:fs"), crypto=require("node:crypto");
    const digest=crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex");
    if(digest!=="189baa08fd6d2dd34db099de411bd6b2e6bd5eb88e81236a3d0fa3826b9715c4") throw Error("libde265 source checksum mismatch")' "$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$BUILD"
  SRC="$BUILD/libde265-1.1.3"
fi

# 2. Configure + build the static decoder library with Emscripten
echo "[hevc-wasm] configuring libde265 (emcmake)..."
emcmake cmake -S "$SRC" -B "$BUILD/obj" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_DECODER=OFF -DENABLE_SDL=OFF \
  -DENABLE_ENCODER=OFF

echo "[hevc-wasm] building libde265 static lib..."
cmake --build "$BUILD/obj" --target de265 -j4

LIB="$(find "$BUILD/obj" -name 'libde265.a' | head -1)"
if [ -z "$LIB" ]; then
  echo "[hevc-wasm] ERROR: libde265.a not found after build" >&2
  exit 1
fi
echo "[hevc-wasm] static lib: $LIB"

# 3. Link the wrapper into an ES module wasm bundle.
#    em++ ensures the C++ runtime from libde265 is linked.
echo "[hevc-wasm] linking wasm module..."
# Single-threaded build (no -pthread): stable and self-contained. Decoding runs
# off the main thread via the decode worker, so the UI stays smooth without the
# pthread+memory-growth heap corruption seen in nested module workers.
em++ -O3 "$HERE/wrapper.c" "$LIB" \
  -I "$SRC/libde265" -I "$BUILD/obj/libde265" -I "$BUILD/obj" -I "$SRC" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s INITIAL_MEMORY=268435456 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s STACK_SIZE=8388608 \
  -s EXPORTED_FUNCTIONS='["_hevc_init","_hevc_push","_hevc_pull","_hevc_pts","_hevc_out_ptr","_hevc_width","_hevc_height","_hevc_chroma_width","_hevc_chroma_height","_hevc_reset","_hevc_free","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","cwrap"]' \
  -o "$OUT/hevc.js"

echo "[hevc-wasm] done -> $OUT/hevc.js + $OUT/hevc.wasm"
