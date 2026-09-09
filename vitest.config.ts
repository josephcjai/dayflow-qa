import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/**/*.spec.ts'],
    // Files are numbered (01-auth, 02-isolation, ... 13-proxy) and MUST run in that order,
    // sequentially: the API's auth rate limiter is a single in-memory bucket per apparent IP for
    // the whole container's lifetime, shared across every file. 13-proxy.spec.ts deliberately
    // exhausts it (checklist #7) and must run last, or every later registerTestUser() call would
    // start failing with 429 — it's been renumbered twice now (07 → 10 → 13) as new files needed
    // to slot in ahead of it; whatever the highest number is, that's the one that must stay last.
    // Do not enable fileParallelism or file shuffling.
    fileParallelism: false,
    sequence: { shuffle: false },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
