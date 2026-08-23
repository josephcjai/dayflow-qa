/**
 * Checklist items 1–3 (docs/TECHNICAL_PLAN.md / onboarding §7).
 * Item 1 in particular encodes a real, previously-confirmed bug: login used to accept ANY
 * password and silently overwrite the real one. This suite exists so that never regresses
 * silently.
 */
import { describe, it, expect } from 'vitest';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser } from '../shared/testUser.js';

const api = new ApiClient();

describe('auth', () => {
  it('registers a new user and returns a usable token', async () => {
    const user = await registerTestUser();
    expect(user.token).toBeTruthy();
    expect(user.id).toBeTruthy();

    const me = await user.client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
  });

  it('rejects registration with a password under 6 characters (400)', async () => {
    const res = await api.post('/auth/register', {
      email: `qa-${Date.now()}@dayflow-qa.test`,
      password: '123',
      displayName: 'Too Short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects registering an email that already has an account (400), and does not alter it', async () => {
    const user = await registerTestUser();

    const dup = await api.post('/auth/register', {
      email: user.email,
      password: 'SomeOtherPassword9',
      displayName: 'Impersonator',
    });
    expect(dup.status).toBe(400);

    // The original account must still authenticate with its original password.
    const login = await api.post('/auth/login', { email: user.email, password: user.password });
    expect(login.status).toBe(200);
    expect(login.body.user.displayName).toBe(user.displayName);
  });

  it('logs in with correct credentials (200 + token)', async () => {
    const user = await registerTestUser();
    const res = await api.post('/auth/login', { email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('REGRESSION (checklist #1): wrong password must return 401 and must NEVER issue a token', async () => {
    const user = await registerTestUser();

    const res = await api.post('/auth/login', {
      email: user.email,
      password: 'DefinitelyWrongPassword9',
    });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();

    // The real password must still work — a wrong attempt must not have overwritten it.
    const stillWorks = await api.post('/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(stillWorks.status).toBe(200);
  });

  it('rejects login for an email that was never registered (401, not 500/404)', async () => {
    const res = await api.post('/auth/login', {
      email: `nobody-${Date.now()}@dayflow-qa.test`,
      password: 'WhateverPassword9',
    });
    expect(res.status).toBe(401);
  });

  it('GET /auth/me with no token returns 401', async () => {
    const res = await api.get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me with a garbage/spoofed bearer token returns 401, not a spoofed identity', async () => {
    const res = await api.get('/auth/me', { Authorization: 'Bearer not-a-real-jwt' });
    expect(res.status).toBe(401);
  });
});
