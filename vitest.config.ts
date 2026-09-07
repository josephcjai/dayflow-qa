import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/**/*.spec.ts'],
    // Files are numbered (01-auth, 02-isolation, ... 10-proxy) and MUST run in that order,
    // sequentially: the API's auth rate limiter is a single in-memory bucket per apparent IP for
    // the whole container's lifetime, shared across every file. 10-proxy.spec.ts deliberately
    // exhausts it (checklist #7) and must run last, or every later registerTestUser() call would
    // start failing with 429 — that's also why it's numbered 10, not 07: three new files (date
    // bounds, todo due dates, note sheets) needed to slot in before it, not after.
    // Do not enable fileParallelism or file shuffling.
    fileParallelism: false,
    sequence: { shuffle: false },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
