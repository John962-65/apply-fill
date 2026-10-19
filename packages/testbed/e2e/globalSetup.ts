import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const browser = process.env.APPLYFILL_E2E_BROWSER === 'edge' ? 'edge' : 'chrome';
const extensionOutput = path.resolve(repoRoot, `apps/extension/.output/${browser}-mv3`);

export default function globalSetup(): void {
  execSync(`pnpm --filter @applyfill/extension exec wxt build -b ${browser}`, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (!existsSync(path.join(extensionOutput, 'manifest.json'))) {
    throw new Error(`extension build output missing at ${extensionOutput}`);
  }
}
