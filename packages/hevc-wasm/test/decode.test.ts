import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLibde265Backend, hevcWasm, WasmHevcDecoder } from '../src/index.js';
import { Logger, type PluginContext } from '@yumyum-player/core';

// sample.hevc is a tiny real HEVC Annex-B bitstream (64x64, 4:2:0) produced by
// ffmpeg/libx265. Exercises the actual libde265 WASM build end-to-end in Node.
const fixture = fileURLToPath(new URL('./sample.hevc', import.meta.url));

it('registers the software HEVC decoder with the default plugin', () => {
  const logger = new Logger('test');
  const registerDecoder = vi.fn<PluginContext['registerDecoder']>();
  hevcWasm().install({ logger, registerDecoder, registerLoader: vi.fn() });

  expect(registerDecoder).toHaveBeenCalledWith('h265-sw', expect.any(Function));
  const [, factory] = registerDecoder.mock.calls[0];
  expect(factory({ logger, onFrame: vi.fn(), onError: vi.fn() })).toBeInstanceOf(WasmHevcDecoder);
});

describe('libde265 WASM backend', () => {
  it('decodes a real HEVC frame into a 4:2:0 YUV picture', async () => {
    const bitstream = new Uint8Array(readFileSync(fixture));
    const backend = createLibde265Backend();
    await backend.init();

    const frame = backend.decode(bitstream, 0);
    expect(frame).not.toBeNull();
    expect(frame!.width).toBe(64);
    expect(frame!.height).toBe(64);
    // Packed RGBA: width * height * 4 bytes.
    expect(frame!.data.length).toBe(64 * 64 * 4);

    // Real picture data, not an all-zero buffer.
    let sum = 0;
    for (let i = 0; i < frame!.data.length; i++) sum += frame!.data[i];
    expect(sum).toBeGreaterThan(0);

    backend.destroy();
  }, 20000);
});
