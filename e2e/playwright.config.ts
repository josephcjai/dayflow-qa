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
  //
  // 2026-09-08: even at 4 workers, a 3-run stress test still showed an ~11% full-suite flake rate
  // (a different test each time — a click-then-immediate-Enter race in one run, a reload-timing
  // one in another) — genuine Docker Desktop resource contention between the containers and
  // several concurrent Chromium instances on this machine, not a product bug or a single test's
  // fault. Dropped to 2 workers and added 1 local retry (previously CI-only) as an honest
  // acknowledgment of that, rather than pretending zero-retry determinism when it isn't there.
  workers: 2,
  timeout: 45_000,
  retries: process.env.CI ? 2 : 1,
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
