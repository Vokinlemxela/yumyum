/*
 * Thin C wrapper around libde265 for WebAssembly.
 *
 * Exposes a tiny stable ABI to JavaScript:
 *   hevc_init()                 -> 0 ok, <0 error
 *   hevc_decode(ptr, len)       -> 1 frame ready, 0 none yet, <0 error
 *   hevc_out_ptr()              -> pointer to tightly-packed Y|U|V planes
 *   hevc_width()/hevc_height()  -> luma dimensions
 *   hevc_chroma_width()/height()-> chroma dimensions (4:2:0)
 *   hevc_reset()                -> reset decoder state (seek/flush)
 *   hevc_free()                 -> release decoder + buffers
 *
 * The output buffer holds Y (w*h), then U (cw*ch), then V (cw*ch), each tightly
 * packed (stride removed) so JS can slice planes directly for the WebGL renderer.
 */
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "de265.h"

/* Keep C linkage: em++ compiles .c as C++, which would otherwise mangle the
 * exported symbol names and break -sEXPORTED_FUNCTIONS. */
#ifdef __cplusplus
extern "C" {
#endif

static de265_decoder_context* g_ctx = NULL;
static uint8_t* g_out = NULL;
static int g_out_cap = 0;
static int g_w = 0, g_h = 0, g_cw = 0, g_ch = 0;
static double g_pts = 0; /* PTS of the last decoded picture (display order) */

EMSCRIPTEN_KEEPALIVE
int hevc_init(int threads) {
  (void)threads; /* reserved; this build is single-threaded for stability */
  if (g_ctx) return 0;
  g_ctx = de265_new_decoder();
  if (!g_ctx) return -1;
  /* Single-threaded decode. Emscripten -pthread + memory growth corrupts the
     heap in nested module workers (out-of-bounds), so we run without worker
     threads. Decoding still happens off the main thread via the decode worker. */
  de265_start_worker_threads(g_ctx, 0);
  return 0;
}

/* Push one Annex-B access unit (pts in microseconds) and decode as far as the
   pushed data allows. Resulting pictures are retrieved with hevc_pull().
   We do NOT call de265_push_end_of_frame: libde265 delimits access units via
   AUD/first-slice and reorders B-frames itself. */
EMSCRIPTEN_KEEPALIVE
int hevc_push(const uint8_t* data, int len, double pts) {
  if (!g_ctx) return -2;
  de265_push_data(g_ctx, data, len, (de265_PTS)pts, NULL);

  int more = 1;
  de265_error err = DE265_OK;
  do {
    more = 0;
    err = de265_decode(g_ctx, &more);
  } while (more && err == DE265_OK); /* drain all decodable data */
  return 0;
}

/* Pull the next decoded picture (display order) into g_out as packed RGBA.
   Call repeatedly after hevc_push() until it returns 0. Returns 1 on a picture. */
EMSCRIPTEN_KEEPALIVE
int hevc_pull(void) {
  if (!g_ctx) return 0;

  const de265_image* img = de265_get_next_picture(g_ctx);
  if (!img) return 0;

  g_pts = (double) de265_get_image_PTS(img);

  int yw = de265_get_image_width(img, 0);
  int yh = de265_get_image_height(img, 0);
  int sY = 0;
  const uint8_t* pY = de265_get_image_plane(img, 0, &sY);

  /* Bail safely on missing/degenerate luma rather than reading out of bounds. */
  if (!pY || yw <= 0 || yh <= 0 || sY < yw) {
    de265_release_next_picture(g_ctx);
    return 0;
  }

  int sU = 0, sV = 0;
  const uint8_t* pU = de265_get_image_plane(img, 1, &sU);
  const uint8_t* pV = de265_get_image_plane(img, 2, &sV);
  int srcCW = de265_get_image_width(img, 1);
  int srcCH = de265_get_image_height(img, 1);
  int is420 = (de265_get_chroma_format(img) == de265_chroma_420) &&
              pU && pV && srcCW > 0 && srcCH > 0 && sU >= srcCW && sV >= srcCW;

  /* Output packed RGBA (BT.709) so JS can build an ImageBitmap and render via
     the fast 2D drawImage path — no WebGL needed. */
  int total = yw * yh * 4;
  if (total > g_out_cap) {
    free(g_out);
    g_out = (uint8_t*)malloc(total);
    g_out_cap = total;
  }
  if (!g_out) {
    de265_release_next_picture(g_ctx);
    return -3;
  }

  for (int y = 0; y < yh; y++) {
    const uint8_t* yr = pY + y * sY;
    const uint8_t* ur = is420 ? pU + (y >> 1) * sU : 0;
    const uint8_t* vr = is420 ? pV + (y >> 1) * sV : 0;
    uint8_t* o = g_out + y * yw * 4;
    for (int x = 0; x < yw; x++) {
      int Y = yr[x];
      int U = is420 ? (ur[x >> 1] - 128) : 0;
      int V = is420 ? (vr[x >> 1] - 128) : 0;
      int r = Y + ((V * 1613) >> 10);
      int g = Y - ((U * 192 + V * 479) >> 10);
      int b = Y + ((U * 1901) >> 10);
      o[0] = r < 0 ? 0 : (r > 255 ? 255 : r);
      o[1] = g < 0 ? 0 : (g > 255 ? 255 : g);
      o[2] = b < 0 ? 0 : (b > 255 ? 255 : b);
      o[3] = 255;
      o += 4;
    }
  }

  g_w = yw; g_h = yh; g_cw = 0; g_ch = 0; /* chroma getters unused (output is RGBA) */

  de265_release_next_picture(g_ctx);
  return 1;
}

EMSCRIPTEN_KEEPALIVE uint8_t* hevc_out_ptr(void) { return g_out; }
EMSCRIPTEN_KEEPALIVE double hevc_pts(void) { return g_pts; }
EMSCRIPTEN_KEEPALIVE int hevc_width(void) { return g_w; }
EMSCRIPTEN_KEEPALIVE int hevc_height(void) { return g_h; }
EMSCRIPTEN_KEEPALIVE int hevc_chroma_width(void) { return g_cw; }
EMSCRIPTEN_KEEPALIVE int hevc_chroma_height(void) { return g_ch; }

EMSCRIPTEN_KEEPALIVE
void hevc_reset(void) {
  if (g_ctx) de265_reset(g_ctx);
}

EMSCRIPTEN_KEEPALIVE
void hevc_free(void) {
  if (g_ctx) { de265_free_decoder(g_ctx); g_ctx = NULL; }
  free(g_out);
  g_out = NULL;
  g_out_cap = 0;
  g_w = g_h = g_cw = g_ch = 0;
}

#ifdef __cplusplus
}
#endif
