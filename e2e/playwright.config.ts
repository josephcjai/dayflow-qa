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
  // Every worker is a separate Chromium instance hitting the SAME shared api-qa/postgres-qa
  // containers — full default parallelism (one worker per CPU core) caused a real, reproducible
  // timeout under load on this machine (a test that passed cleanly alone exceeded its 30s budget
  // at 6 concurrent workers). Capped rather than left to chase environment-specific flakes.
  workers: 4,
  timeout: 45_000,
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
