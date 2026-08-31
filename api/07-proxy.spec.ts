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

async function attemptLogin(origin?: string, xForwardedFor?: string) {
  return fetch(`${proxyApi}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {}),
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
    "checklist #7b — a client can't dodge the limit by forging its own X-Forwarded-For " +
      "(RESOLVED, was previously red — server.ts now sets app.set('trust proxy', 1). This test's " +
      'original form tried to simulate "two different clients" purely from this one test-runner ' +
      "machine with no distinguishing signal at all, which could never pass regardless of the fix " +
      '— trust proxy=1 correctly trusts only what nginx itself directly observed, one hop back, ' +
      "and correctly ignores a value the client injects further back in the chain, which is what " +
      "that attempt actually was. This rewrite tests something trust proxy=1 can really prove: " +
      "spoofing X-Forwarded-For must NOT be a way to evade the limiter.)",
    async () => {
      let limited = false;
      for (let i = 0; i < 55 && !limited; i++) {
        const res = await attemptLogin();
        if (res.status === 429) limited = true;
      }
      expect(limited).toBe(true);

      // A fresh-looking, client-supplied X-Forwarded-For must not reset or dodge the limit —
      // trust proxy=1 should still key on what nginx itself saw, not this claimed value.
      const spoofed = await attemptLogin(undefined, '203.0.113.250');
      expect(spoofed.status).toBe(429);
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
