// HEVC decode worker: runs the libde265 WASM module off the main thread so
// software decoding never blocks rendering or the network/segment loop.
//
// Shipped as a static asset (not bundled). Loaded as a module worker:
//   new Worker(url, { type: 'module' })
// Protocol (main -> worker): {type:'init', glueUrl, threads} | {type:'decode',
//   data:ArrayBuffer, pts} | {type:'reset'} | {type:'destroy'}
// (worker -> main): {type:'ready'} | {type:'frame', pts,width,height,y,u,v} |
//   {type:'error', message}

let mod = null;
let ready = false;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      const factory = (await import(msg.glueUrl)).default;
      // Carry any ?v=... cache-bust from the glue URL onto the .wasm fetch too.
      const q = msg.glueUrl.includes('?') ? msg.glueUrl.slice(msg.glueUrl.indexOf('?')) : '';
      mod = await factory(q ? { locateFile: (p) => p + q } : {});
      const rc = mod._hevc_init(msg.threads || 0);
      if (rc !== 0) {
        self.postMessage({ type: 'error', message: 'hevc_init failed: ' + rc });
        return;
      }
      ready = true;
      self.postMessage({ type: 'ready' });
      return;
    }

    if (msg.type === 'decode') {
      if (!ready || !mod) return;
      const u8 = new Uint8Array(msg.data);
      const len = u8.length;
      if (len <= 0) return;

      const ptr = mod._malloc(len);
      if (!ptr) {
        self.postMessage({ type: 'error', message: 'malloc(' + len + ') failed' });
        return;
      }
      mod.HEAPU8.set(u8, ptr);
      try {
        mod._hevc_push(ptr, len, msg.pts || 0);
      } catch (trap) {
        mod._free(ptr);
        self.postMessage({ type: 'error', message: 'decode trap: ' + ((trap && trap.message) || trap) });
        return;
      }
      mod._free(ptr);

      // Drain ALL pictures this push produced (copy RGBA out synchronously so a
      // later pull can't overwrite the heap region before we read it).
      const out = [];
      while (mod._hevc_pull() === 1) {
        const w = mod._hevc_width();
        const h = mod._hevc_height();
        const o = mod._hevc_out_ptr();
        out.push({ w, h, pts: mod._hevc_pts(), rgba: new Uint8ClampedArray(mod.HEAPU8.subarray(o, o + w * h * 4)) });
      }
      for (const fr of out) {
        const bitmap = await createImageBitmap(new ImageData(fr.rgba, fr.w, fr.h));
        self.postMessage({ type: 'frame', pts: fr.pts, bitmap }, [bitmap]);
      }
      return;
    }

    if (msg.type === 'reset') {
      if (mod) mod._hevc_reset();
      return;
    }

    if (msg.type === 'destroy') {
      if (mod) mod._hevc_free();
      mod = null;
      ready = false;
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
