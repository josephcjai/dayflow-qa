import { defineConfig, devices } from '@playwright/test';
import { ENV } from '../shared/env.js';

/**
 * Points at nginx-qa via the dayflow-qa.local hostname, never localhost — see
 * docs/ARCHITECTURE.md §4 for why that's required for the frontend to call the right backend at
 * all. Requires a one-line hosts-file entry; see README.md quick start.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ENV.e2eBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
