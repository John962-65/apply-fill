import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const extensionOutput = path.resolve(repoRoot, 'apps/extension/.output/chrome-mv3');

export default function globalSetup(): void {
  execSync('pnpm --filter @applyfill/extension build', {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (!existsSync(path.join(extensionOutput, 'manifest.json'))) {
    throw new Error(`extension build output missing at ${extensionOutput}`);
  }
}
