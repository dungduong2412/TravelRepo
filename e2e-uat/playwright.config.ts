import { defineConfig } from '@playwright/test';
import { config, EVIDENCE_DIR, loadEnvFile } from './lib/env';

loadEnvFile();
const c = config(); // throws if the target is not the approved UAT host

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${EVIDENCE_DIR}/artifacts`,
  reporter: [['list'], ['html', { outputFolder: `${EVIDENCE_DIR}/html-report`, open: 'never' }], ['./lib/reporter.ts']],
  use: {
    baseURL: c.web,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off', // videos could capture claim links / passwords being typed
    actionTimeout: 20_000,
  },
});
