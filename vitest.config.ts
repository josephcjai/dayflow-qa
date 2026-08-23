import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/**/*.spec.ts'],
    // Files are numbered (01-auth, 02-isolation, ... 07-proxy) and MUST run in that order,
    // sequentially: the API's auth rate limiter is a single in-memory bucket per apparent IP for
    // the whole container's lifetime, shared across every file. 07-proxy.spec.ts deliberately
    // exhausts it (checklist #7) and must run last, or every later registerTestUser() call would
    // start failing with 429. Do not enable fileParallelism or file shuffling.
    fileParallelism: false,
    sequence: { shuffle: false },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
