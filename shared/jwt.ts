/**
 * Signs an HS256 JWT with the QA stack's own JWT_SECRET (docker-compose.test.yml — a QA-owned,
 * throwaway value, never a dev/prod secret). Lets a test craft tokens the API itself would never
 * issue: a legacy token with no `tokenVersion` claim, a future `tokenVersion`, a token for a user
 * that doesn't exist, a malformed `userId`. Implemented with node:crypto so no dependency is added.
 */
import { createHmac } from 'node:crypto';

export const QA_JWT_SECRET = process.env.JWT_SECRET ?? 'qa-test-only-secret-do-not-use-in-prod';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signQaJwt(payload: Record<string, unknown>, secret = QA_JWT_SECRET, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ ...payload, iat: now, exp: now + ttlSeconds });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
