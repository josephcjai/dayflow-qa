/**
 * Self-provisions a fresh, uniquely-emailed user through the public API for a single test/suite —
 * never via direct DB access or baked fixtures. See docs/GROUND_RULES.md and
 * ARCHITECTURE.md §1 ("black-box only"). The user is thrown away with the container on teardown;
 * nothing here needs cleanup.
 */
import { randomUUID } from 'node:crypto';
import { ApiClient } from './apiClient.js';

export interface TestUser {
  email: string;
  password: string;
  displayName: string;
  id: string;
  token: string;
  client: ApiClient; // pre-authenticated
}

export async function registerTestUser(
  baseClient = new ApiClient(),
  overrides: Partial<{ password: string; displayName: string }> = {}
): Promise<TestUser> {
  const email = `qa-${randomUUID()}@dayflow-qa.test`;
  const password = overrides.password ?? 'CorrectHorseBattery9';
  const displayName = overrides.displayName ?? 'QA Test User';

  const res = await baseClient.post('/auth/register', { email, password, displayName });
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(
      `registerTestUser: expected 200 + token from /auth/register, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  return {
    email,
    password,
    displayName,
    id: res.body.user.id,
    token: res.body.token,
    client: baseClient.as(res.body.token),
  };
}
