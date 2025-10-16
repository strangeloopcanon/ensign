import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  // Electron app uses single-instance lock; run tests serially
  workers: 1,
});
