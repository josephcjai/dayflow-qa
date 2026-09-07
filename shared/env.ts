/**
 * Central place every layer (api/, e2e/, and eventually mobile/) reads its target environment
 * from. Loads .env.test if present (see .env.test.example), falling back to the same defaults
 * baked into docker-compose.test.yml so a fresh clone works without any setup beyond copying
 * the example file.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// import.meta.url, not __dirname — this file is loaded both by Vitest (which shims __dirname
// even under "type": "module") and by Playwright's own config loader (which doesn't; confirmed
// live — Playwright's loader treats this as real native ESM and __dirname throws there).
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '..', '.env.test') });

function envOr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const ENV = {
  apiBaseUrl: envOr('API_BASE_URL', 'http://localhost:5100/api'),
  // Only Playwright/browser-loaded pages need the special hostname (see ARCHITECTURE.md §4 —
  // it's the frontend's own hostname-sniffing logic that cares, not nginx). Raw-HTTP Layer 1
  // tests that go through nginx on purpose (api/10-proxy.spec.ts) use proxyBaseUrl instead, so
  // they don't force a hosts-file dependency onto the API suite.
  e2eBaseUrl: envOr('E2E_BASE_URL', 'http://dayflow-qa.local:8280'),
  proxyBaseUrl: `http://localhost:${envOr('QA_WEB_PORT', '8280')}`,
  webHost: envOr('QA_WEB_HOST', 'dayflow-qa.local'),
  webOrigin: envOr('QA_WEB_ORIGIN', 'http://dayflow-qa.local:8280'),
};
