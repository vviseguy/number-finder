import { defineConfig } from '@playwright/test';

// End-to-end tests run the BUILT single file (dist/numberfinder.html) straight from disk, the way
// people will open it, in the Microsoft Edge that's already installed (no browser download).
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    channel: 'msedge',
    viewport: { width: 1360, height: 900 },
    acceptDownloads: true,
  },
});
