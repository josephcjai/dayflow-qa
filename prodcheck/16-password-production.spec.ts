/**
 * Added 2026-09-21 for commit 8fbc404 (change/forgot/reset password), re-tested against 0563993.
 * The parts that only show up with NODE_ENV=production, against the api-qa-prodcheck* containers
 * (docker-compose.prodcheck.yml): api-qa-prodcheck = healthy DB, APP_URL set, BREVO_API_KEY unset
 * (a deployment that hasn't wired email yet); -baddb = wrong DB password; -noappurl = APP_URL omitted.
 *
 * Deliberately NOT tested: forgot-password with a real/fake BREVO_API_KEY — the API would POST the
 * recipient's address to api.brevo.com, and QA does not send data to third parties. That path
 * (provider call, async dispatch, provider-failure handling) is source-reviewed only, so the
 * production-mode *timing* of forgot-password with mail configured is also not measured here.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser } from '../shared/testUser.js';
import { signQaJwt } from '../shared/jwt.js';

const PORT = process.env.QA_API_PRODCHECK_PORT || '5101';
const BAD_PORT = process.env.QA_API_PRODCHECK_BADDB_PORT || '5102';
const api = new ApiClient(`http://localhost:${PORT}/api`);
const badDb = new ApiClient(`http://localhost:${BAD_PORT}/api`);
const OK = 'dayflow-qa-api-prodcheck';

/** stdout AND stderr — `docker logs` replays a container's stderr on ours (Node's fatal errors and console.warn/error live there). */
function docker(...args: string[]): string {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

describe('password management under NODE_ENV=production', () => {
  it('refuses to boot without APP_URL: the container exits at once with a FATAL message (Finding 14, fixed in 0563993)', () => {
    const status = docker('inspect', '-f', '{{.State.Status}}|{{.State.ExitCode}}', 'dayflow-qa-api-prodcheck-noappurl').trim();
    const [state, code] = status.split('|');
    expect(state).toBe('exited');
    expect(Number(code)).not.toBe(0);
    expect(docker('logs', 'dayflow-qa-api-prodcheck-noappurl')).toMatch(/APP_URL environment variable must be set in production/);
  });

  it('with no mail provider configured, forgot-password is a 503 for existing AND unknown emails alike, and nothing secret is logged (Finding 20, fixed in 0563993)', async () => {
    const u = await registerTestUser(api);
    const existing = await api.post('/auth/forgot-password', { email: u.email });
    const unknown = await api.post('/auth/forgot-password', { email: `nobody-${Date.now()}@dayflow-qa.test` });
    expect(existing.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(unknown.body).toEqual(existing.body); // no enumeration through the failure mode either
    // invalid input is still a 400 (validation runs before the availability check)
    expect((await api.post('/auth/forgot-password', { email: '' })).status).toBe(400);

    const logs = docker('logs', OK);
    const leaked = logs.split(/\r?\n/).some((l) => l.includes('#reset-password?token=') || l.includes(encodeURIComponent(u.email)) || l.includes('Text Content'));
    expect(leaked).toBe(false);
  });

  it('non-string inputs are now 400 in production (were a masked 500), and specific 400 messages still pass through', async () => {
    const u = await registerTestUser(api);
    const badToken = await api.post('/auth/reset-password', { email: u.email, token: 12345, newPassword: 'BrandNewPassw0rd!' });
    expect(badToken.status).toBe(400);
    const wrong = await u.client.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'BrandNewPassw0rd!' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/incorrect/i);
    const bad = await api.post('/auth/reset-password', { email: u.email, token: 'f'.repeat(64), newPassword: 'BrandNewPassw0rd!' });
    expect(bad.status).toBe(400);
  });

  it('change-password still works in production with no mail provider (the "password changed" notice is best-effort), and revokes the old session', async () => {
    const u = await registerTestUser(api);
    const res = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: 'BrandNewPassw0rd!' });
    expect(res.status).toBe(200);
    expect((await api.as(u.token).get('/auth/me')).status).toBe(401);
    expect((await api.as(res.body.token).get('/auth/me')).status).toBe(200);
  });

  it('registration and login carry hasPassword in production too', async () => {
    const u = await registerTestUser(api);
    const login = await api.post('/auth/login', { email: u.email, password: u.password });
    expect(login.body.user.hasPassword).toBe(true);
  });

  // Finding 24 (fixed in 165bd81) — the session-version check used to fail OPEN. With the DB unreachable
  // (-baddb), a token REVOKED by a password change on the healthy container must still be refused.
  it('with the DB unreachable, a revoked session token gets a 503 (fail closed) and nothing internal leaks (Finding 24)', async () => {
    const u = await registerTestUser(api);
    const revoked = u.token; // version 1
    const change = await u.client.post('/auth/change-password', { currentPassword: u.password, newPassword: 'BrandNewPassw0rd!' });
    expect(change.status).toBe(200);
    const res = await badDb.as(revoked).get('/todos/week/2026-09-07');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/password authentication failed|ECONNREFUSED|pg_hba|token_version/i);
    // ...and so does a CURRENT token: no route can be reached while the session cannot be verified
    const current = await badDb.as(change.body.token).get('/todos/week/2026-09-07');
    expect(current.status).toBe(503);
  });

  it('with the DB down, a forged token for an unknown user cannot read data (nothing fabricated, nothing leaked)', async () => {
    const t = signQaJwt({ userId: '00000000-0000-0000-0000-000000000000', email: 'x@dayflow-qa.test', tokenVersion: 1 });
    const res = await badDb.as(t).get('/todos/week/2026-09-07');
    expect([401, 503]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/password authentication failed|ECONNREFUSED|pg_hba/i);
  });
});
