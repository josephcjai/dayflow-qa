/**
 * Added 2026-09-21 for commit 8fbc404 (change/forgot/reset password). The parts that only show up
 * with NODE_ENV=production, against the api-qa-prodcheck container (healthy DB, APP_URL set to
 * https://dayflow-qa.example, BREVO_API_KEY unset — like a deployment that hasn't wired email yet).
 * See docker-compose.prodcheck.yml and the regular api/15-password-management.spec.ts.
 *
 * Deliberately NOT tested: forgot-password with a real/fake BREVO_API_KEY — the API would POST the
 * recipient's address to api.brevo.com, and QA does not send data to third parties. The code path
 * (provider failure is swallowed, generic 200 returned) is source-reviewed only.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser } from '../shared/testUser.js';
import { waitForResetLink } from '../shared/mailbox.js';

const BASE = `http://localhost:${process.env.QA_API_PRODCHECK_PORT || '5101'}/api`;
const CONTAINER = 'dayflow-qa-api-prodcheck';
const api = new ApiClient(BASE);

describe('password management under NODE_ENV=production', () => {
  it('with APP_URL set, the reset link uses it and ignores an attacker-supplied Origin/Referer', async () => {
    const u = await registerTestUser(api);
    const forged = await api.post('/auth/forgot-password', { email: u.email }, {
      Origin: 'http://evil.example',
      Referer: 'http://evil2.example/x',
    });
    expect(forged.status).toBe(200);
    const link = await waitForResetLink(u.email, { container: CONTAINER });
    expect(link.base).toBe('https://dayflow-qa.example/');
    expect(link.url).not.toMatch(/evil/);
  });

  it('a non-string reset token is still a 500 in production, but the message is masked (no internals leaked)', async () => {
    const u = await registerTestUser(api);
    const res = await api.post('/auth/reset-password', { email: u.email, token: 12345, newPassword: 'BrandNewPassw0rd!' });
    // Still a server error (Finding 16 — should be 400), but never "token.trim is not a function".
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('a wrong current password and a bad reset token keep their specific 400 messages in production (not masked)', async () => {
    const u = await registerTestUser(api);
    const wrong = await u.client.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'BrandNewPassw0rd!' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/incorrect/i);
    const bad = await api.post('/auth/reset-password', { email: u.email, token: 'f'.repeat(64), newPassword: 'BrandNewPassw0rd!' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/invalid or has already been used/i);
  });

  // Finding 20 — with BREVO_API_KEY unset, EmailService "simulates" sending by logging the whole
  // message, reset link and live token included, at every NODE_ENV — production too — while the
  // endpoint still tells the user a link "has been dispatched".
  it.fails('a production deployment never writes a live reset token to its logs (Finding 20)', async () => {
    const u = await registerTestUser(api);
    const forgot = await api.post('/auth/forgot-password', { email: u.email });
    expect(forgot.status).toBe(200);
    const logs = execFileSync('docker', ['logs', CONTAINER], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const leaked = logs
      .split(/\r?\n/)
      .some((line) => line.includes("#reset-password?token=") && line.includes(encodeURIComponent(u.email)));
    expect(leaked).toBe(false);
  });
});
