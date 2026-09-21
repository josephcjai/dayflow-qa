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
 * reports/2026-09-21-*.md. Fixed and plain `it` now: 14, 15, 16, 21 (0563993); 17, 19, 23, 24 (165bd81).
 * Still open: 18 (one doc string), 25 (legacy long-password accounts locked out), 26 (login timing
 * oracle), 27 (register email length -> 500), 28 (reset-token double-spend race).
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
import { setStoredPasswordDirectly } from '../shared/legacyAccount.js';

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
});

describe('password length limits (Findings 19, 25)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 19 (fixed in 165bd81) — the limit is now measured in BYTES, matching bcrypt.
  it("passwords over bcrypt's 72-BYTE limit are refused on register, change and reset; exactly 72 bytes is accepted (Finding 19)", async () => {
    const stamp = Date.now();
    const over = await api.post('/auth/register', { email: `mb1-${stamp}@dayflow-qa.test`, password: 'é'.repeat(40) + 'AAAA' });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/72 bytes/);
    expect((await api.post('/auth/register', { email: `mb2-${stamp}@dayflow-qa.test`, password: 'é'.repeat(37) })).status).toBe(400); // 74 bytes
    expect((await api.post('/auth/register', { email: `mb3-${stamp}@dayflow-qa.test`, password: '😀'.repeat(19) })).status).toBe(400); // 76 bytes
    expect((await api.post('/auth/register', { email: `mb4-${stamp}@dayflow-qa.test`, password: 'é'.repeat(36) })).status).toBe(200); // exactly 72 bytes
    expect((await api.post('/auth/register', { email: `mb5-${stamp}@dayflow-qa.test`, password: '😀'.repeat(18) })).status).toBe(200); // exactly 72 bytes

    const u = await registerTestUser();
    const change = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: 'é'.repeat(40) });
    expect(change.status).toBe(400);
    expect(change.body.error).toMatch(/72 bytes/);
    const link = await requestReset(u.email);
    const reset = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: 'é'.repeat(40) });
    expect(reset.status).toBe(400);
    expect(reset.body.error).toMatch(/72 bytes/);
  });

  it('login rejects a password longer than 72 bytes with the same generic 401 (no truncated comparison)', async () => {
    const u = await registerTestUser();
    const res = await api.post('/auth/login', { email: u.email, password: u.password + 'x'.repeat(80) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });

  // Finding 25 (new) — the rule above also makes login refuse ANY password over 72 bytes, including
  // the real password of an account created back when that was legal. Such a user is told "Invalid
  // email or password" (only the first 72 characters still work, which they cannot know). The
  // historical account is simulated with shared/legacyAccount.ts (the one documented exception to
  // "public API only").
  it.fails('an account created before the 72-byte rule can still sign in with its own (long) password (Finding 25)', async () => {
    const u = await registerTestUser();
    const longPassword = 'L'.repeat(80);
    setStoredPasswordDirectly(u.id, longPassword);
    const res = await api.post('/auth/login', { email: u.email, password: longPassword });
    expect(res.status).toBe(200);
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

  // Finding 24 (fixed in 165bd81) — the version check used to FAIL OPEN. A validly-signed token with a
  // malformed userId is now a 401 (never reaches a route / a raw Postgres error). The DB-unreachable half
  // (503; a revoked token is still refused) lives in prodcheck/16.
  it('a token with a malformed userId (not a UUID, an object, a number, empty, huge) is a 401, never a 500 (Finding 24)', async () => {
    for (const userId of ['not-a-uuid', { a: 1 }, 12345, '', 'x'.repeat(500)]) {
      const t = signQaJwt({ userId, email: 'x@dayflow-qa.test', tokenVersion: 1 });
      const res = await api.as(t).get('/auth/me');
      expect(res.status, `userId=${JSON.stringify(userId).slice(0, 20)}`).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/invalid input syntax|uuid/i);
    }
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

  // Finding 23 (fixed in 165bd81)
  it('register validates displayName: non-string or over 100 characters is a 400 (Finding 23)', async () => {
    const stamp = Date.now();
    for (const displayName of [{ a: 1 }, ['x'], 'n'.repeat(101)]) {
      const res = await api.post('/auth/register', {
        email: `dn-${stamp}-${Math.random()}@dayflow-qa.test`,
        password: 'abcdefg',
        displayName,
      });
      expect(res.status, `displayName=${JSON.stringify(displayName).slice(0, 30)}`).toBe(400);
    }
    const ok = await api.post('/auth/register', { email: `dn100-${stamp}@dayflow-qa.test`, password: 'abcdefg', displayName: 'n'.repeat(100) });
    expect(ok.status).toBe(200);
  });

  // Finding 27 (new, Low; pre-existing) — the same "unvalidated length -> raw DB 500" class, on email:
  // users.email is varchar(255) and register only checks the type.
  it.fails('register rejects an email longer than 255 characters with a 400, not a 500 (Finding 27)', async () => {
    for (const local of ['e'.repeat(249), 'e'.repeat(290)]) {
      const res = await api.post('/auth/register', { email: `${local}@x.test`, password: 'abcdefg' });
      expect(res.status, `email length ${local.length + 7}`).toBe(400);
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

  // Finding 17 (fixed in 165bd81 via a 100 ms response-time floor): 20 interleaved pairs, medians.
  it('forgot-password latency does not reveal whether the account exists (Finding 17)', async () => {
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

describe('reset token single-use (Finding 28)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 28 (new — and a CORRECTION to QA's own earlier report). The 2026-09-21 review listed "a
  // reset token is single-use even under a concurrent race" as verified-correct, based on 5 concurrent
  // requests that happened to serialise. Re-run at 8 concurrent requests, ONE token was accepted 2-7
  // times in 14 of 14 trials: the route reads the token (used = false), then hashes the new password
  // (bcrypt, ~60-100 ms), and only afterwards sets used = TRUE — every request that arrives inside that
  // window passes the check. Each success also bumps token_version, and the LAST writer's password wins.
  // Fix: consume the token atomically (UPDATE ... SET used = TRUE WHERE id = $1 AND used = FALSE
  // RETURNING id, and proceed only if a row came back).
  it.fails('concurrent use of one token succeeds exactly once (no double-spend race) (Finding 28)', async () => {
    // Three independent tokens, 8 concurrent requests each; the scheduling is not deterministic (in a
    // 14-token trial 100% double-spent, but an individual token can occasionally be serialised by
    // luck), so EVERY token must be spent exactly once. 3 x (1 + 8) + 3 registrations stays inside
    // the 50-attempt auth budget of this describe's fresh bucket.
    for (let attempt = 0; attempt < 3; attempt++) {
      const u = await registerTestUser();
      const link = await requestReset(u.email);
      const pws = Array.from({ length: 8 }, (_, i) => `Race-Passw0rd-${i}-x`);
      const results = await Promise.all(
        pws.map((newPassword) => api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword }))
      );
      expect(results.filter((r) => r.status === 200), `token ${attempt + 1}`).toHaveLength(1);
    }
  });

  it('after a token has been spent, replaying it (sequentially) is always refused', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    expect((await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const replay = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: `Replay-Passw0rd-${i}` });
      expect(replay.status).toBe(400);
    }
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(200);
  });
});

describe('account-existence timing on login (Finding 26)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 26 (new; pre-existing) — forgot-password now pads every response to 100 ms, but /login still
  // only runs bcrypt when the email exists: ~65 ms vs ~3 ms with an identical 401 body, a ~20x oracle
  // that makes the padding above pointless for an attacker who can simply try to log in.
  it.fails('login latency for a wrong password does not reveal whether the email is registered (Finding 26)', async () => {
    const u = await registerTestUser();
    const time = async (email: string) => {
      const s = performance.now();
      await api.post('/auth/login', { email, password: 'wrong-password-123' });
      return performance.now() - s;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 12; i++) {
      known.push(await time(u.email));
      unknown.push(await time(`nobody-${i}-${Date.now()}@dayflow-qa.test`));
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    expect(median(known) / median(unknown)).toBeLessThan(1.5);
  });
});

describe('documented contract vs. real responses (docs/API_DOCUMENTATION.md sections 1.6-1.8)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 18 (nearly fixed in 165bd81): every message but ONE now appears verbatim — the reset-password
  // SUCCESS message still differs from the documented one. Rule enforced: every message the API really
  // returns for these endpoints must appear verbatim in the documented section.
  it.fails('every message the API returns for change/forgot/reset appears verbatim in the docs (Finding 18)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(path.resolve(here, '..', 'contract', 'API_CONTRACT.md'), 'utf8');
    const start = doc.indexOf('### 1.1');
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
      'password over 72 bytes': (await api.post('/auth/register', { email: `doc-${Date.now()}@dayflow-qa.test`, password: 'é'.repeat(40) })).body.error,
      'displayName not a string': (await api.post('/auth/register', { email: `doc2-${Date.now()}@dayflow-qa.test`, password: 'abcdefg', displayName: { a: 1 } })).body.error,
      'revoked session': (await api.as(signQaJwt({ userId: u.id, email: u.email, tokenVersion: 99 })).get('/auth/me')).body.error,
    };
    const missing = Object.entries(real).filter(([, msg]) => !section.includes(msg));
    expect(missing, `not documented verbatim: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
