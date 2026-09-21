/**
 * Added 2026-09-17 for commit 1be7769 ("feat: production hardening, HTTPS reverse proxy,
 * database migration decoupling, and process resilience"). Covers the two behaviors that ONLY
 * activate when NODE_ENV=production, confirmed by source read of every route file and
 * utils/errorHandler.ts:
 *
 *   1. Every route that used to silently fall back to the in-memory store on a Postgres error now
 *      does `if (process.env.NODE_ENV === 'production') throw e;` instead — production never
 *      serves a fabricated/incomplete response in place of a real database.
 *   2. utils/errorHandler.ts's `sendError` masks any 500-level error's message behind a generic
 *      fallback in production ("Internal server error", or "Database connection unavailable" for
 *      the health check specifically) so internal details (stack traces, DB connection strings,
 *      Postgres error text) never reach a client response. 400-level messages are NOT masked —
 *      confirmed those still need to reach real users (e.g. "Invalid priority: must be High,
 *      Medium, or Low").
 *
 * Neither is observable against the regular api-qa container (NODE_ENV=test, by design — see its
 * comment in docker-compose.test.yml), so this needs the two dedicated containers brought up by
 * `npm run prodcheck:up` (see docker-compose.prodcheck.yml for exactly what they are and why).
 *
 * Run with `npm run test:prodmode` — NOT part of the regular `npm run test:api` count (kept
 * separate deliberately, so the regression suite's pass count stays stable across rounds
 * regardless of whether a production-mode check happens to run that round too).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../shared/apiClient.js';

const GOOD_DB_URL = `http://localhost:${process.env.QA_API_PRODCHECK_PORT || '5101'}/api`;
const BAD_DB_URL = `http://localhost:${process.env.QA_API_PRODCHECK_BADDB_PORT || '5102'}/api`;

describe('Production mode (NODE_ENV=production) — happy path against a healthy DB', () => {
  const api = new ApiClient(GOOD_DB_URL);
  let token: string;

  beforeAll(async () => {
    const email = `qa-prodcheck-${randomUUID()}@dayflow-qa.test`;
    const res = await api.post('/auth/register', { email, password: 'CorrectHorseBattery9', displayName: 'Prod Check' });
    expect(res.status).toBe(200);
    token = res.body.token;
  });

  it('register/login/todo CRUD all work normally under NODE_ENV=production with a healthy DB', async () => {
    const authed = api.as(token);
    const created = await authed.post('/todos/todo', { weekStart: '2026-01-05', text: 'Prod mode smoke test' });
    expect(created.status).toBe(200);
    const week = await authed.get('/todos/week/2026-01-05');
    expect(week.status).toBe(200);
    expect(week.body.todos.some((t: any) => t.text === 'Prod mode smoke test')).toBe(true);
  });

  it('a 400-level validation error is NOT masked in production — the specific message still reaches the client', async () => {
    const authed = api.as(token);
    const created = await authed.post('/todos/todo', { weekStart: '2026-01-05', text: 'to be patched' });
    const id = created.body.todo.id;
    const res = await authed.patch(`/todos/${id}`, { priority: 'Not-A-Real-Priority' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid priority/i);
  });

  it('GET /api/health reports a healthy, connected database', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
  });
});

describe('Production mode (NODE_ENV=production) — masking behavior with a broken DB connection', () => {
  const goodDbApi = new ApiClient(GOOD_DB_URL);
  const badDbApi = new ApiClient(BAD_DB_URL);
  let tokenFromGoodContainer: string;

  beforeAll(async () => {
    // Minted against the healthy-DB container, but verified purely by JWT signature — both
    // containers share the same JWT_SECRET, and authMiddleware.ts never touches the database to
    // validate a token (confirmed by source read) — so this token is valid against the
    // broken-DB container too, letting us reach its authenticated, DB-touching routes at all.
    const email = `qa-prodcheck-baddb-${randomUUID()}@dayflow-qa.test`;
    const res = await goodDbApi.post('/auth/register', { email, password: 'CorrectHorseBattery9', displayName: 'Prod Check BadDB' });
    tokenFromGoodContainer = res.body.token;
  });

  it('GET /api/health reports degraded/disconnected, with the error masked to a generic message', async () => {
    const res = await badDbApi.get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('disconnected');
    // Masked — must NOT be the raw Postgres auth failure text ("password authentication failed
    // for user ..."), which would leak internal connection details to a client.
    expect(res.body.error).toBe('Database connection unavailable');
    expect(res.body.error).not.toMatch(/password authentication failed/i);
  });

  it('a DB-touching authenticated route fails closed with a masked 503 — NOT a silent fallback to fabricated data', async () => {
    const authed = badDbApi.as(tokenFromGoodContainer);
    const res = await authed.get('/todos/week/2026-01-05');
    // In NODE_ENV=test (the regular api-qa container), this exact scenario (a DB error mid-request)
    // would silently fall back to the in-memory store and return 200 with whatever's in memory —
    // that fallback path is exactly what production mode refuses to take.
    // UPDATED 2026-09-21 (165bd81, Finding 24): this used to be a masked 500 from the route itself. The
    // auth middleware's session-version lookup now fails CLOSED first, so the request is refused with a
    // 503 before any route runs — same guarantee (nothing fabricated, nothing leaked), better status.
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password authentication failed|ECONNREFUSED|pg_hba/i);
  });

  it('registration itself fails loudly (masked 500) rather than silently succeeding via the memory-store fallback', async () => {
    const email = `qa-prodcheck-baddb-register-${randomUUID()}@dayflow-qa.test`;
    const res = await badDbApi.post('/auth/register', { email, password: 'CorrectHorseBattery9', displayName: 'Should Not Work' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
