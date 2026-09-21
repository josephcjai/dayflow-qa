/**
 * Added 2026-09-21 for commit 8fbc404 ("add change password in settings and forgot password with
 * Brevo email integration"): POST /auth/change-password, /auth/forgot-password,
 * /auth/reset-password, plus `hasPassword` on GET /auth/me. Security-sensitive, so this file is
 * deliberately strict about behaviour a production deployment must have.
 *
 * How the emailed token is obtained: QA has no mail server. With BREVO_API_KEY unset (always, in
 * QA) the API logs the "sent" message — reset link included — to stdout; shared/mailbox.ts reads it
 * back from `docker logs`. Black-box: it observes an external side-effect, never the DB.
 * Not testable black-box: the 1-hour token EXPIRY (no way to age a token without DB access or
 * waiting an hour) — the expired-token branch is source-reviewed only.
 *
 * Rate-limit budget: /auth/* shares one 50-attempt/15-min bucket per IP, and each describe below
 * gets a fresh one (freshAuthRateLimitBucket restarts api-qa; no data lost) — plus one more at the
 * end so neighbouring files start clean regardless of run order.
 *
 * Known defects are encoded with `it.fails`: the test asserts the CORRECT behaviour, passes while
 * the bug exists, and turns red ("expected to fail but passed") the moment it's fixed — at which
 * point convert it to a plain `it`. Finding numbers refer to reports/2026-09-21-*.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser } from '../shared/testUser.js';
import { freshAuthRateLimitBucket } from '../shared/dockerControl.js';
import { waitForResetLink, resetLinksFor } from '../shared/mailbox.js';

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

  it('rejects a missing/short/non-string newPassword with 400 (never 500)', async () => {
    const u = await registerTestUser();
    for (const newPassword of [undefined, '', 'abc', 'abcde', 12345678, ['abcdefgh'], { length: 99 }]) {
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

  it('changes the password: old one stops working, new one works, and /me reports hasPassword', async () => {
    const u = await registerTestUser();
    const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(401);
    expect((await api.post('/auth/login', { email: u.email, password: NEW_PW })).status).toBe(200);
    const me = await u.client.get('/auth/me');
    expect(me.body.user.hasPassword).toBe(true);
  });

  it("one user's change never affects another user's password", async () => {
    const a = await registerTestUser();
    const b = await registerTestUser();
    const res = await a.client.post('/auth/change-password', { currentPassword: a.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.post('/auth/login', { email: b.email, password: b.password })).status).toBe(200);
  });

  // Finding 16
  it.fails('a non-string currentPassword is a 400, not a 500 (Finding 16)', async () => {
    const u = await registerTestUser();
    for (const currentPassword of [{ a: 1 }, 123, ['x']]) {
      const res = await u.client.post('/auth/change-password', { currentPassword, newPassword: NEW_PW });
      expect(res.status, `currentPassword=${JSON.stringify(currentPassword)}`).toBeLessThan(500);
    }
  });

  // Finding 15
  it.fails('a session token issued BEFORE a password change is rejected afterwards (Finding 15)', async () => {
    const u = await registerTestUser();
    const oldToken = u.token;
    const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    const stale = await api.as(oldToken).get('/auth/me');
    expect(stale.status).toBe(401);
  });

  // Finding 19 (pre-existing in /register too, now also reachable via change/reset)
  it.fails('passwords differing only after bcrypt 72-byte limit are not treated as the same (Finding 19)', async () => {
    const u = await registerTestUser(new ApiClient(), { password: 'a'.repeat(72) + 'SUFFIX-ONE' });
    const other = await api.post('/auth/login', { email: u.email, password: 'a'.repeat(72) + 'DIFFERENT' });
    expect(other.status).toBe(401);
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

  // Finding 14 — api-qa has no APP_URL (same as any deployment whose .env omits it)
  it.fails('the emailed reset link never points at an attacker-supplied Origin header (Finding 14)', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email, { Origin: 'http://evil.example' });
    expect(link.base).not.toMatch(/evil\.example/);
  });

  it.fails('the emailed reset link never points at an attacker-supplied Referer header (Finding 14)', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email, { Referer: 'http://evil2.example/some/path?x=1' });
    expect(link.base).not.toMatch(/evil2\.example/);
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
    const wrongToken = await api.post('/auth/reset-password', {
      email: u.email,
      token: 'f'.repeat(64),
      newPassword: NEW_PW,
    });
    const wrongEmail = await api.post('/auth/reset-password', {
      email: other.email,
      token: link.token,
      newPassword: NEW_PW,
    });
    const unknown = await api.post('/auth/reset-password', {
      email: 'nobody@dayflow-qa.test',
      token: link.token,
      newPassword: NEW_PW,
    });
    for (const r of [wrongToken, wrongEmail, unknown]) expect(r.status).toBe(400);
    expect(wrongEmail.body).toEqual(wrongToken.body);
    expect(unknown.body).toEqual(wrongToken.body);
    // none of the failed attempts (incl. a different account's email) touched either account
    expect((await api.post('/auth/login', { email: other.email, password: other.password })).status).toBe(200);
    expect((await api.post('/auth/login', { email: u.email, password: u.password })).status).toBe(200);
  });

  it('validation failures (missing fields, short password) are 400 and do NOT consume the token', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    for (const body of [
      { token: link.token, newPassword: NEW_PW },
      { email: u.email, newPassword: NEW_PW },
      { email: u.email, token: link.token },
      { email: u.email, token: link.token, newPassword: 'abc' },
    ]) {
      expect((await api.post('/auth/reset-password', body)).status).toBe(400);
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

  // Finding 16
  it.fails('non-string token / email is a 400, not a 500 (Finding 16)', async () => {
    const u = await registerTestUser();
    const link = await requestReset(u.email);
    for (const body of [
      { email: u.email, token: 12345, newPassword: NEW_PW },
      { email: u.email, token: { a: 1 }, newPassword: NEW_PW },
      { email: 12345, token: link.token, newPassword: NEW_PW },
    ]) {
      const res = await api.post('/auth/reset-password', body);
      expect(res.status, JSON.stringify(body)).toBeLessThan(500);
    }
  });

  // Finding 15
  it.fails('a session token issued BEFORE a password reset is rejected afterwards (Finding 15)', async () => {
    const u = await registerTestUser();
    const oldToken = u.token;
    const link = await requestReset(u.email);
    const res = await api.post('/auth/reset-password', { email: u.email, token: link.token, newPassword: NEW_PW });
    expect(res.status).toBe(200);
    expect((await api.as(oldToken).get('/auth/me')).status).toBe(401);
  });
});

describe('documented contract vs. real responses (docs/API_DOCUMENTATION.md sections 1.6-1.8)', () => {
  beforeAll(async () => {
    await freshAuthRateLimitBucket();
  });

  // Finding 18 — the docs quote different message strings than the API returns
  it.fails('forgot-password and unauthenticated change-password return the messages the docs show (Finding 18)', async () => {
    const u = await registerTestUser();
    const forgot = await api.post('/auth/forgot-password', { email: u.email });
    expect(forgot.body.message).toBe(
      'If an account exists with this email, password reset instructions have been dispatched.'
    );
    const unauth = await api.post('/auth/change-password', { currentPassword: 'x', newPassword: 'abcdefg' });
    expect(unauth.body.error).toBe('Unauthorized');
  });
});
