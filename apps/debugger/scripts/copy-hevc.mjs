// Copy the HEVC-WASM assets into public/ so Next.js serves them statically.
// Runs automatically before `dev` and `build`.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '../../../packages/hevc-wasm');
const dst = join(here, '../public/hevc');

if (!existsSync(join(pkg, 'wasm/hevc.wasm'))) {
  console.warn('[debugger] hevc.wasm not found — run `npm run wasm -w @yumyum-player/hevc-wasm` first. Skipping.');
  process.exit(0);
}

mkdirSync(dst, { recursive: true });
copyFileSync(join(pkg, 'wasm/hevc.js'), join(dst, 'hevc.js'));
copyFileSync(join(pkg, 'wasm/hevc.wasm'), join(dst, 'hevc.wasm'));
copyFileSync(join(pkg, 'worker/decode-worker.js'), join(dst, 'decode-worker.js'));
console.log('[debugger] copied HEVC-WASM assets (wasm + worker) -> public/hevc');
