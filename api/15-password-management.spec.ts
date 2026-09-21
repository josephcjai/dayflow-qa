/**
 * Added 2026-09-21 for commit 8fbc404 ("add change password in settings and forgot password with
 * Brevo email integration"), re-tested against 0563993 ("address QA password management findings
 * 13-22"): POST /auth/change-password, /auth/forgot-password, /auth/reset-password, plus
 * `hasPassword` on the auth responses. Security-sensitive, so deliberately strict.
 *
 * How the emailed token is obtained: QA has no mail server. With BREVO_API_KEY unset and
 * NODE_ENV != production (always, on api-qa) the API logs the "sent" message — reset link included —
 * to stdout; shared/mailbox.ts reads it back from `docker logs`. (As of 0563993 that simulation is
 * disabled in production — see prodcheck/16.) Not testable black-box: the 1-hour token EXPIRY.
 *
 * Rate-limit budget: /auth/* shares one 50-attempt/15-min bucket per IP; each describe gets a fresh
 * one (freshAuthRateLimitBucket restarts api-qa; no data lost) plus one at the end.
 *
 * Findings still open after 0563993 are held with `it.fails` (asserts the CORRECT behaviour; passes
 * while the bug exists; goes red when fixed → convert to a plain `it`). Numbers refer to
 * reports/2026-09-21-*.md. Findings fixed in 0563993 are plain `it` now: 14, 15, 16, 21, and most of 19.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser } from '../shared/testUser.js';
import { freshAuthRateLimitBucket } from '../shared/dockerControl.js';
import { waitForResetLink, resetLinksFor } from '../shared/mailbox.js';
import { signQaJwt } from '../shared/jwt.js';

const api = new ApiClient();
const NEW_PW = 'BrandNewPassw0rd!';

async function requestReset(email: string, headers?: Record<string, string>) {
  const before = resetLinksFor(email).length;
  const res = await api.post('/auth/forgot-password', { email }, headers);
  expect(res.status).toBe(200);
  return waitForResetLink(email, { minCount: before + 1 });
}

afterAll(async () => {
  await freshAuthRateLimitBucket();
});

describe('POST /auth/change-password (authenticated)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await api.post('/auth/change-password', { currentPassword: 'x', newPassword: 'abcdefg' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing/short/whitespace-only/over-long/non-string newPassword with 400 (never 500)', async () => {
    const u = await registerTestUser();
    for (const newPassword of [undefined, '', 'abc', 'abcde', '      ', 'a'.repeat(73), 12345678, ['abcdefgh'], { length: 99 }]) {
      const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword });
      expect(res.status, `newPassword=${JSON.stringify(newPassword)}`).toBe(400);
    }
  });

  it('requires the current password when the account has one, and rejects a wrong one — password unchanged', async () => {
    const u = await registerTestUser();
    const missing = await u.client.post('/auth/change-password', { newPassword: NEW_PW });
    expect(missing.status).toBe(400);
    const wrong = await u.client.post('/auth/change-password', {
      currentPassword: 'not-the-password',
      newPassword: NEW_PW,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/incorrect/i);
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(401);
  });

  it('a non-string currentPassword is a 400, not a 500 (Finding 16, fixed in 0563993)', async () => {
    const u = await registerTestUser();
    for (const currentPassword of [{ a: 1 }, 123, ['x']]) {
      const res = await u.client.post('/auth/change-password', { currentPassword, newPassword: NEW_PW });
      expect(res.status, `currentPassword=${JSON.stringify(currentPassword)}`).toBe(400);
    }
  });

  it('changes the password: old one stops working, new one works; the response carries a fresh working session token', async () => {
    const u = await registerTestUser();
    const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(401);
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(200);
    const me = await api.as(res.body.token).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.hasPassword).toBe(true);
  });

  it('every session issued BEFORE the change is revoked, the fresh one survives (Finding 15, fixed in 0563993)', async () => {
    const u = await registerTestUser();
    const secondDevice = (await api.post('/auth/login', { email: u.email, password: u.password })).body.token;
    expect((await api.as(secondDevice).get('/auth/me')).status).toBe(200);

    const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);

    expect((await api.as(u.token).get('/auth/me')).status).toBe(401); // the token it was called with
    expect((await api.as(secondDevice).get('/auth/me')).status).toBe(401); // a different session
    expect((await api.as(res.body.token).get('/auth/me')).status).toBe(200); // the fresh one
    // and a protected data route rejects the stale token too, not just /me
    expect((await api.as(u.token).get('/todos/week/2026-09-07')).status).toBe(401);
  });

  it("one user's change never affects another user's password or session", async () => {
    const a = await registerTestUser();
    const b = await registerTestUser();
    const res = await a.client.post('/auth/change-password', { currentPassword: a.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.post('/auth/login', { email: b.email, password: b.password })).status).toBe(200);
    expect((await api.as(b.token).get('/auth/me')).status).toBe(200);
  });

  it('a change followed by a second change works with the fresh token (version keeps incrementing)', async () => {
    const u = await registerTestUser();
    const first = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    const second = await api.as(first.body.token).post('/auth/change-password', {
      currentPassword: NEW_PW,
      newPassword: 'ThirdPassw0rd!x',
    });
    expect(second.status).toBe(200);
    expect((await api.as(first.body.token).get('/auth/me')).status).toBe(401);
    expect((await api.as(second.body.token).get('/auth/me')).status).toBe(200);
  });

  // Finding 19 (residual) — 0563993 limits password.length to 72 CHARACTERS, but bcrypt truncates at
  // 72 BYTES. 40 x "é" is 40 characters (accepted) but 80 bytes, so two passwords that differ only
  // after byte 72 (character 36) are still the same password.
  it.fails('multi-byte passwords that differ only after bcrypt\'s 72-BYTE limit are not the same password (Finding 19)', async () => {
    const email = `qa-mb-${Date.now()}@dayflow-qa.test`;
    const reg = await api.post('/auth/register', { email, password: 'é'.repeat(40) + 'AAAA', displayName: 'mb' });
    expect(reg.status).toBe(200);
    const other = await api.post('/auth/login', { email, password: 'é'.repeat(36) + 'ZZZZ' });
    expect(other.status).toBe(401);
  });
});

describe('session tokens (tokenVersion revocation)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  it('a legacy token WITHOUT a tokenVersion claim still works for an account that never changed its password (no forced logout on deploy)', async () => {
    const u = await registerTestUser();
    const legacy = signQaJwt({ userId: u.id, email: u.email });
    expect((await api.as(legacy).get('/auth/me')).status).toBe(200);
  });

  it('a legacy token stops working once the password has been changed', async () => {
    const u = await registerTestUser();
    const legacy = signQaJwt({ userId: u.id, email: u.email });
    await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    expect((await api.as(legacy).get('/auth/me')).status).toBe(401);
  });

  it('a token with a future/other tokenVersion (number or string), or for a user that does not exist, is rejected with 401', async () => {
    const u = await registerTestUser();
    for (const tokenVersion of [99, 0, -1, '1', null]) {
      const t = signQaJwt({ userId: u.id, email: u.email, tokenVersion });
      const res = await api.as(t).get('/auth/me');
      // null is treated like "absent" (?? 1) and is the same as a legacy token; everything else must be refused
      expect(res.status, `tokenVersion=${JSON.stringify(tokenVersion)}`).toBe(tokenVersion === null ? 200 : 401);
    }
    const ghost = signQaJwt({ userId: '00000000-0000-0000-0000-000000000000', email: 'ghost@dayflow-qa.test', tokenVersion: 1 });
    expect((await api.as(ghost).get('/auth/me')).status).toBe(401);
  });

  // Finding 24 — the version check FAILS OPEN: if its DB lookup throws, the catch swallows the error and
  // the token is accepted at version 1. A validly-signed token whose userId isn't a UUID makes the
  // lookup throw and sails through to the route (which then 500s with a raw Postgres message).
  it.fails('a token whose session-version lookup errors is rejected (fail closed), not passed through to the route (Finding 24)', async () => {
    const t = signQaJwt({ userId: 'not-a-uuid', email: 'x@dayflow-qa.test', tokenVersion: 1 });
    const res = await api.as(t).get('/auth/me');
    expect([401, 503]).toContain(res.status);
  });
});

describe('register / login validation and hasPassword (Findings 19, 21)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  it('register and login both return hasPassword: true (Finding 21, fixed in 0563993)', async () => {
    const email = `qa-hp-${Date.now()}@dayflow-qa.test`;
    const reg = await api.post('/auth/register', { email, password: 'CorrectHorseBattery9', displayName: 'hp' });
    expect(reg.status).toBe(200);
    expect(reg.body.user.hasPassword).toBe(true);
    const login = await api.post('/auth/login', { email, password: 'CorrectHorseBattery9' });
    expect(login.body.user.hasPassword).toBe(true);
  });

  it('register rejects whitespace-only and over-72-character passwords, accepts exactly 72 (Finding 19)', async () => {
    const stamp = Date.now();
    expect((await api.post('/auth/register', { email: `ws-${stamp}@dayflow-qa.test`, password: '        ' })).status).toBe(400);
    const tooLong = await api.post('/auth/register', { email: `long-${stamp}@dayflow-qa.test`, password: 'a'.repeat(73) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/72/);
    expect((await api.post('/auth/register', { email: `ok72-${stamp}@dayflow-qa.test`, password: 'a'.repeat(72) })).status).toBe(200);
  });

  it('register / login reject non-string email or password with 400 (never 500)', async () => {
    for (const body of [
      { email: { a: 1 }, password: 'abcdefg' },
      { email: 'x@dayflow-qa.test', password: ['abcdefg'] },
      { email: 42, password: 'abcdefg' },
    ]) {
      expect((await api.post('/auth/register', body)).status, `register ${JSON.stringify(body)}`).toBe(400);
      expect((await api.post('/auth/login', body)).status, `login ${JSON.stringify(body)}`).toBe(400);
    }
  });

  // Finding 23 (Low, found in this round; pre-existing) — public /register does not validate displayName
  it.fails('register validates displayName: a non-string or over-100-character value is a 400, not stored / not a 500 (Finding 23)', async () => {
    const stamp = Date.now();
    for (const displayName of [{ a: 1 }, ['x'], 'n'.repeat(200)]) {
      const res = await api.post('/auth/register', { email: `dn-${stamp}-${Math.random()}@dayflow-qa.test`, password: 'abcdefg', displayName });
      expect(res.status, `displayName=${JSON.stringify(displayName).slice(0, 30)}`).toBe(400);
    }
  });
});

describe('POST /auth/forgot-password (public)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  it('answers identically (status AND body) for an existing and an unknown email — no enumeration by response', async () => {
    const u = await registerTestUser();
    const existing = await api.post('/auth/forgot-password', { email: u.email });
    const unknown = await api.post('/auth/forgot-password', { email: `nobody-${Date.now()}@dayflow-qa.test` });
    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(existing.status);
    expect(unknown.body).toEqual(existing.body);
  });

  it('rejects missing / empty / non-string emails with 400', async () => {
    for (const email of [undefined, '', { a: 1 }, ['x@y.test'], 42]) {
      const res = await api.post('/auth/forgot-password', { email });
      expect(res.status, `email=${JSON.stringify(email)}`).toBe(400);
    }
  });

  it('is case- and whitespace-insensitive on the email, and issues a 64-hex token', async () => {
    const u = await registerTestUser();
    const before = resetLinksFor(u.email).length;
    const res = await api.post('/auth/forgot-password', { email: `  ${u.email.toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const link = await waitForResetLink(u.email, { minCount: before + 1 });
    expect(link.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a newer request invalidates the previous, unused token', async () => {
    const u = await registerTestUser();
    const first = await requestReset(u.email);
    const second = await requestReset(u.email);
    expect(second.token).not.toBe(first.token);
    const old = await api.post('/auth/reset-password', { email: u.email, token: first.token, newPassword: NEW_PW });
    expect(old.status).toBe(400);
    const cur = await api.post('/auth/reset-password', { email: u.email, token: second.token, newPassword: NEW_PW });
    expect(cur.status).toBe(200);
  });

  it('the emailed link ignores an attacker-supplied Origin or Referer (Finding 14, fixed in 0563993)', async () => {
    const u = await registerTestUser();
    const viaOrigin = await requestReset(u.email, { Origin: 'http://evil.example' });
    expect(viaOrigin.url).not.toMatch(/evil/);
    const viaReferer = await requestReset(u.email, { Referer: 'http://evil2.example/some/path?x=1' });
    expect(viaReferer.url).not.toMatch(/evil/);
    // outside production, with APP_URL unset, the only permitted base is the fixed localhost default
    expect(viaOrigin.base).toBe('https://localhost/');
    expect(viaReferer.base).toBe('https://localhost/');
  });

  // Finding 17 (NOT resolved by 0563993) — existing accounts still cost ~2x: dev added trivial dummy
  // hashing for unknown emails, but the difference is the DB writes (invalidate old tokens + insert a
  // new one) that only the existing-account path performs. Measured with 20 interleaved pairs; medians.
  it.fails('forgot-password latency does not reveal whether the account exists (Finding 17)', async () => {
    const u = await registerTestUser();
    const time = async (email: string) => {
      const s = performance.now();
      await api.post('/auth/forgot-password', { email });
      return performance.now() - s;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 20; i++) {
      known.push(await time(u.email));
      unknown.push(await time(`nobody-${i}-${Date.now()}@dayflow-qa.test`));
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    expect(median(known) / median(unknown)).toBeLessThan(1.5);
  });
});

describe('POST /auth/reset-password (public, token from email)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  it('resets the password: new works, old fails, and the token is single-use', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    const res = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(401);
    const replay = await api.post('/auth/reset-password', {
      email: u.email,
      token: link.token,
      newPassword: 'AnotherPassw0rd!',
    });
    expect(replay.status).toBe(400);
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(200); // replay changed nothing
  });

  it('a wrong token, a wrong email, and an unknown email all fail with the same 400 body (no enumeration)', async () => {
    const u = await registerTestUser();
    const other = await registerTestUser();
    const link = await requestReset(u.email);
    const wrongToken = await api.post('/auth/reset-password', { email: u.email, token: 'f'.repeat(64), newPassword: NEW_PW });
    const wrongEmail = await api.post('/auth/reset-password', { email: other.email, token: link.token, newPassword: NEW_PW });
    const unknown = await api.post('/auth/reset-password', { email: 'nobody@dayflow-qa.test', token: link.token, newPassword: NEW_PW });
    for (const r of [wrongToken, wrongEmail, unknown]) expect(r.status).toBe(400);
    expect(wrongEmail.body).toEqual(wrongToken.body);
    expect(unknown.body).toEqual(wrongToken.body);
    expect((await api.post('/auth/login', { email: other.email, password: other.password })).status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(200);
  });

  it('validation failures (missing, short, whitespace-only, over-72, non-string) are 400 and do NOT consume the token', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    for (const body of [
      { token: link.token, newPassword: NEW_PW },
      { email: u.email, newPassword: NEW_PW },
      { email: u.email, token: link.token },
      { email: u.email, token: link.token, newPassword: 'abc' },
      { email: u.email, token: link.token, newPassword: '       ' },
      { email: u.email, token: link.token, newPassword: 'a'.repeat(73) },
      { email: u.email, token: 12345, newPassword: NEW_PW },
      { email: u.email, token: { a: 1 }, newPassword: NEW_PW },
      { email: 12345, token: link.token, newPassword: NEW_PW },
      { email: u.email, token: link.token, newPassword: ['abcdefg'] },
    ]) {
      const res = await api.post('/auth/reset-password', body);
      expect(res.status, JSON.stringify(body)).toBe(400); // incl. Finding 16, fixed in 0563993
    }
    const ok = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW });
    expect(ok.status).toBe(200);
  });

  it('tolerates a padded token and a mixed-case email', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    const res = await api.post('/auth/reset-password', {
      email: u.email.toUpperCase(),
      token: `  ${link.token}  `,
      newPassword: NEW_PW,
    });
    expect(res.status).toBe(200);
  });

  it('concurrent use of one token succeeds exactly once (no double-spend race)', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    const pws = Array.from({ length: 5 }, (_, i) => `Race-Passw0rd-${i}-x`);
    const results = await Promise.all(
      pws.map((newPassword) => api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword }))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    let winners = 0;
    for (const p of pws) {
      if ((await api.post('/auth/login', { email: u.email, password: p })).status === 200) winners++;
    }
    expect(winners).toBe(1);
  });

  it('a reset revokes every existing session, including one held by an attacker (Finding 15, fixed in 0563993)', async () => {
    const u = await registerTestUser();
    const stolen = u.token;
    const link = await requestReset(u.email);
    const res = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.as(stolen).get('/auth/me')).status).toBe(401);
    // a new login after the reset works and gets a working token
    const login = await api.post('/auth/login', { email: u.email, password: NEW_PW });
    expect((await api.as(login.body.token).get('/auth/me')).status).toBe(200);
  });
});

describe('documented contract vs. real responses (docs/API_DOCUMENTATION.md sections 1.6-1.8)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 18 (NOT fully resolved by 0563993): forgot-password / 401 / hasPassword docs were aligned,
  // but section 1.8's two error strings were "aligned" to text the API does NOT return — the route
  // messages were not changed. Rule enforced here: every message the API really returns for these
  // endpoints must appear verbatim in the documented section.
  it.fails('every message the API returns for change/forgot/reset appears verbatim in the docs (Finding 18)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(path.resolve(here, '..', 'contract', 'API_CONTRACT.md'), 'utf8');
    const start = doc.indexOf('### 1.6');
    const end = doc.indexOf('## 2.');
    const section = doc.slice(start, end);
    expect(start).toBeGreaterThan(-1);

    const u = await registerTestUser();
    const link = await requestReset(u.email);
    const real: Record<string, string> = {
      'forgot-password success': (await api.post('/auth/forgot-password', { email: u.email })).body.message,
      'unauthenticated change-password': (await api.post('/auth/change-password', { currentPassword: 'x', newPassword: 'abcdefg' })).body.error,
      'wrong current password': (await u.client.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: NEW_PW })).body.error,
      'invalid/used reset token': (await api.post('/auth/reset-password', { email: u.email, token: 'f'.repeat(64), newPassword: NEW_PW })).body.error,
      'reset success': (await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW })).body.message,
    };
    const missing = Object.entries(real).filter(([, msg]) => !section.includes(msg));
    expect(missing, `not documented verbatim: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
