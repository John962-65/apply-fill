import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: `./test-results/${process.env.APPLYFILL_E2E_BROWSER === 'edge' ? 'edge' : 'chrome'}`,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/globalSetup.ts',
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173/react-native.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    trace: 'retain-on-failure',
  },
});
