import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [tag, option] = process.argv.slice(2);
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || (option && option !== '--dry-run')) {
  throw new Error('Usage: node scripts/publish-npm.mjs vX.Y.Z [--dry-run]');
}

const workspaces = ['player-sdk', 'hevc-wasm', 'pro-streaming', 'transport-webrtc'];
const manifests = workspaces.map((workspace) =>
  JSON.parse(readFileSync(`packages/${workspace}/package.json`, 'utf8')),
);
for (const manifest of manifests) {
  if (manifest.private || manifest.version !== tag.slice(1) || manifest.publishConfig?.access !== 'public') {
    throw new Error(`Cannot publish ${manifest.name}@${manifest.version} for ${tag}`);
  }
}

const output = mkdtempSync(path.join(tmpdir(), 'yyp-npm-'));
try {
  const packages = manifests.map(({ name }) => {
    const json = execFileSync(
      'npm', ['pack', '--workspace', name, '--ignore-scripts', '--json', '--pack-destination', output],
      { encoding: 'utf8' },
    );
    const [packed] = JSON.parse(json);
    console.log(`[npm] packed ${packed.id} ${packed.integrity}`);
    return packed;
  });

  if (option !== '--dry-run') {
    // Check every immutable version before writing any packages. A retry can
    // finish a partially published release when the previous archives match.
    const pending = packages.filter((packed) => {
      const result = spawnSync(
        'npm', ['view', packed.id, 'dist.integrity', '--json', '--prefer-online'],
        { encoding: 'utf8' },
      );
      if (result.error) throw result.error;
      const metadata = JSON.parse(result.stdout || 'null');
      if (result.status !== 0) {
        if (metadata?.error?.code === 'E404') return true;
        throw new Error(`Could not read ${packed.id}: ${result.stderr.trim()}`);
      }
      if (metadata !== packed.integrity) {
        throw new Error(`Registry already contains different bytes for ${packed.id}`);
      }
      console.log(`[npm] already published ${packed.id}`);
      return false;
    });

    for (const packed of pending) {
      execFileSync(
        'npm', ['publish', path.join(output, packed.filename), '--access', 'public', '--ignore-scripts'],
        { stdio: 'inherit' },
      );
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
