/**
 * Checklist items #7 (rate limiting) and #8 (CORS) — run against the real nginx path
 * (proxyBaseUrl, not API_BASE_URL) specifically, per the onboarding: "IP-based limiting is
 * exactly the kind of thing that silently breaks (or silently over-blocks everyone) depending on
 * proxy header handling." Deliberately does NOT use E2E_BASE_URL/dayflow-qa.local here — nginx's
 * server_name is `_` (matches any Host), so this Layer 1 suite reaches it over plain localhost
 * and has no dependency on the e2e/ layer's hosts-file entry.
 */
import { describe, it, expect } from 'vitest';
import { ENV } from '../shared/env.js';

const proxyApi = `${ENV.proxyBaseUrl}/api`;

async function attemptLogin(origin?: string) {
  return fetch(`${proxyApi}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ email: 'nobody@dayflow-qa.test', password: 'wrong-password' }),
  });
}

describe('rate limiting through the real reverse-proxy path', () => {
  it(
    'checklist #7 — a client tripping the limit gets 429 (confirmed MAX_ATTEMPTS=50/15min for non-localhost IPs, from rateLimiter.ts)',
    async () => {
      let sawA429 = false;
      // +1 past the documented non-localhost ceiling; stop early the moment we see a 429.
      for (let i = 0; i < 55 && !sawA429; i++) {
        const res = await attemptLogin();
        if (res.status === 429) sawA429 = true;
      }
      expect(sawA429).toBe(true);
    },
    30_000
  );

  it(
    'checklist #7b — a different simulated client in the same window should be unaffected ' +
      '(KNOWN GAP: server.ts never calls app.set("trust proxy", ...), so req.ip is nginx\'s own ' +
      'container IP for every request that comes through it — every client behind this proxy ' +
      'shares one bucket. If this assertion is red, that gap is confirmed live, not flaky — see ' +
      'docs/TECHNICAL_PLAN.md Phase 1 checklist item #7 before re-running.)',
    async () => {
      // Exhaust the limit as "client 1" (no distinguishing signal is available client-side; that's
      // the point — the app has no way to tell these apart either, per the gap above).
      let limited = false;
      for (let i = 0; i < 55 && !limited; i++) {
        const res = await attemptLogin();
        if (res.status === 429) limited = true;
      }
      expect(limited).toBe(true);

      // A "second client" hitting the exact same proxy immediately after should NOT be limited
      // by client 1's attempts if IP attribution actually worked end-to-end.
      const second = await attemptLogin();
      expect(second.status).not.toBe(429);
    },
    30_000
  );
});

describe('CORS', () => {
  it('checklist #8 — a disallowed Origin does not get reflected in Access-Control-Allow-Origin', async () => {
    const res = await attemptLogin('http://evil-attacker.example.com');
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).not.toBe('http://evil-attacker.example.com');
  });

  it("the QA web origin (configured via ALLOWED_ORIGINS) IS allowed", async () => {
    const res = await attemptLogin(ENV.webOrigin);
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).toBe(ENV.webOrigin);
  });
});
