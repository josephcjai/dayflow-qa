/**
 * Added 2026-09-09 for the new Google Sign-In feature (commit d922a30, "feat: add Google
 * Authentication with Google Identity Services and OAuth token verification").
 *
 * What this file CAN and CANNOT cover, and why — worth reading before touching it:
 *
 * A full, successful Google sign-in cannot be tested black-box: it requires a real Google
 * account completing a live consent flow to produce a genuine, signed ID token, which no amount
 * of local tooling can fabricate (that's the whole point of the token — DayFlow's server verifies
 * it was actually issued by Google). Attempting to fake one would mean either mocking Google's
 * verification library (testing our mock, not DayFlow) or bypassing the API to insert a
 * Google-linked user directly into the database, which the ground rules explicitly rule out
 * (self-provision through the public API only — see docs/GROUND_RULES.md).
 *
 * What IS black-box testable, and what this file covers instead: the failure and configuration
 * paths, which need no real Google account at all — missing/malformed credentials, and whether
 * `/api/auth/config` reports the server as configured. `GOOGLE_CLIENT_ID` is set to a
 * fake-but-shaped-like-real value in docker-compose.test.yml specifically so these paths exercise
 * the real verification code (and fail on it), not just the earlier "not configured" short-circuit.
 * Both endpoints here are unauthenticated by design (a visitor needs them before ever logging in),
 * so unlike every other file in this suite, nothing here registers a test user.
 *
 * One thing this file does NOT cover, flagged instead in the report rather than encoded as a
 * test: a Google-only account (no password set — `password_hash` is now nullable, confirmed in
 * schema.sql) attempting the *regular* `POST /api/auth/login` with any password. That specific
 * scenario requires a Google-linked user to exist, which (per the paragraph above) this suite has
 * no way to create. Checked instead via an isolated bcryptjs test (not against DayFlow at all):
 * `bcrypt.compare(password, null)` throws `Illegal arguments: string, object`, uncaught by
 * anything in the login handler, so it would surface as a raw 500, not a clean 401. See the
 * report for the full account of how that was verified.
 */
import { describe, it, expect } from 'vitest';
import { ApiClient } from '../shared/apiClient.js';

const api = new ApiClient();

describe('Google auth — configuration and failure paths', () => {
  it('GET /auth/config reports the server as configured (fake QA client ID is set), no auth required', async () => {
    const res = await api.get('/auth/config');
    expect(res.status).toBe(200);
    expect(typeof res.body.googleClientId).toBe('string');
    expect(res.body.googleClientId.length).toBeGreaterThan(0);
  });

  it('POST /auth/google with no credential is rejected with 400, not 500', async () => {
    const res = await api.post('/auth/google', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/credential/i);
  });

  it('POST /auth/google with a garbage (non-JWT) credential fails gracefully with 401, not 500', async () => {
    const res = await api.post('/auth/google', { credential: 'not-a-real-google-token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid google credential/i);
  });

  it('POST /auth/google with a well-formed-but-fake JWT still fails verification cleanly (401)', async () => {
    // Three base64url segments, JWT-shaped, signed by nobody Google recognizes — exercises the
    // actual signature-verification failure path in google-auth-library, not just a format check.
    const fakeJwt =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJlbWFpbCI6ImZha2VAZXhhbXBsZS5jb20ifQ.' +
      'ZmFrZS1zaWduYXR1cmUtbm90LWZyb20tZ29vZ2xl';
    const res = await api.post('/auth/google', { credential: fakeJwt });
    expect(res.status).toBe(401);
  });

  it('POST /auth/google never returns a 500, across a sweep of malformed shapes', async () => {
    const shapes = ['', '   ', '{}', 'null', '...', 'a'.repeat(2000)];
    for (const credential of shapes) {
      const res = await api.post('/auth/google', { credential });
      expect(res.status).toBeLessThan(500);
    }
  });
});
