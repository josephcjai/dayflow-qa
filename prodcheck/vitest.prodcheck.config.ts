import { defineConfig } from 'vitest/config';

/**
 * Separate config, separate directory, deliberately NOT under api/ so this never gets swept into
 * the regular `npm run test:api` glob (api/**\/*.spec.ts in vitest.config.ts) — these tests need
 * the extra prodcheck containers (`npm run prodcheck:up`) that the regular stack doesn't bring up.
 * Run explicitly with `npm run test:prodmode`. See docker-compose.prodcheck.yml for the "why".
 */
export default defineConfig({
  test: {
    include: ['prodcheck/**/*.spec.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
