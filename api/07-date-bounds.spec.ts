/**
 * Added 2026-09-07 for `isValidDateRange` (server/src/utils/dateValidation.ts), newly wired into
 * schedule/habits/todos GET/POST/DELETE routes as of commit 6fb7686 (see DAYFLOW_PINNED_REF).
 * Confirmed live against the running stack while writing this file, not inferred from source
 * alone — every status code and error message below was actually observed.
 *
 * The rule (from source): a date string must be exactly `YYYY-MM-DD`, a real calendar date, and
 * the year must fall within 1800–2200 inclusive. Anything else is a 400 with a message naming the
 * offending field, not a raw 500 from a Postgres CHECK constraint (schema.sql has the same bound
 * as a DB-level backstop, but the API is expected to catch it first).
 *
 * One shared user for the whole file (via beforeAll), not one per test: none of these checks test
 * isolation between callers, just validation behavior for a single caller — registering fresh per
 * `it.each` case (4 dates × 3 blocks) was needlessly burning through the shared auth rate-limit
 * budget the whole numbered suite has to fit inside before 10-proxy.spec.ts's own deliberate
 * exhaustion. Confirmed live: the full suite hit 429s mid-run before this fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerTestUser, type TestUser } from '../shared/testUser.js';

describe('date-range validation (1800-01-01..2200-12-31)', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerTestUser();
  });

  const outOfRangePast = '1799-12-31';
  const outOfRangeFuture = '2201-01-01';
  const malformed = 'not-a-date';
  const badCalendarDate = '2026-02-30'; // April/June/Sept/Nov have 30 days, Feb never does

  const badDates = [outOfRangePast, outOfRangeFuture, malformed, badCalendarDate];

  it.each(badDates)('GET /schedule/week/%s is rejected with 400, not 500 or silent success', async (bad) => {
    const res = await user.client.get(`/schedule/week/${bad}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1800-01-01.*2200-12-31/);
  });

  it.each(badDates)('GET /habits/week/%s is rejected with 400', async (bad) => {
    const res = await user.client.get(`/habits/week/${bad}`);
    expect(res.status).toBe(400);
  });

  it.each(badDates)('GET /todos/week/%s is rejected with 400', async (bad) => {
    const res = await user.client.get(`/todos/week/${bad}`);
    expect(res.status).toBe(400);
  });

  it('POST /schedule/slot rejects an out-of-range weekStart', async () => {
    const res = await user.client.post('/schedule/slot', {
      weekStart: outOfRangeFuture,
      slotKey: `${outOfRangeFuture}_08:00`,
      plannedTask: 'x',
      actualTask: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('POST /schedule/slot rejects an out-of-range date embedded in slotKey, even with a valid weekStart', async () => {
    const res = await user.client.post('/schedule/slot', {
      weekStart: '2026-09-07',
      slotKey: `${outOfRangeFuture}_08:00`, // slotKey's own date portion is checked separately
      plannedTask: 'x',
      actualTask: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /schedule/slot now requires weekStart and slotKey (400 if missing)', async () => {
    const res = await user.client.delete('/schedule/slot', {});
    expect(res.status).toBe(400);
  });

  it('DELETE /schedule/slot rejects an out-of-range weekStart', async () => {
    const res = await user.client.delete('/schedule/slot', {
      weekStart: malformed,
      slotKey: `2026-09-07_08:00`,
    });
    expect(res.status).toBe(400);
  });

  it('POST /habits/log rejects an out-of-range weekStart', async () => {
    const res = await user.client.post('/habits/log', { weekStart: outOfRangePast, name: 'x', pts: 5 });
    expect(res.status).toBe(400);
  });

  it('POST /habits/log rejects an out-of-range date embedded in a date-like logTime', async () => {
    const res = await user.client.post('/habits/log', {
      weekStart: '2026-09-07',
      name: 'x',
      pts: 5,
      logTime: `${outOfRangeFuture} 09:00 AM`,
    });
    expect(res.status).toBe(400);
  });

  it('POST /todos/todo rejects an out-of-range weekStart', async () => {
    const res = await user.client.post('/todos/todo', { weekStart: outOfRangeFuture, text: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /todos/notes rejects an out-of-range weekStart', async () => {
    const res = await user.client.post('/todos/notes', { weekStart: badCalendarDate, notes: 'x' });
    expect(res.status).toBe(400);
  });

  it('the exact boundary dates (1800-01-01 and 2200-12-31) are accepted, not off-by-one rejected', async () => {
    const early = await user.client.get('/schedule/week/1800-01-01');
    const late = await user.client.get('/schedule/week/2200-12-31');
    expect(early.status).toBe(200);
    expect(late.status).toBe(200);
  });

  it('one day on either side of the boundary is correctly rejected', async () => {
    const tooEarly = await user.client.get('/schedule/week/1799-12-31');
    const tooLate = await user.client.get('/schedule/week/2201-01-01');
    expect(tooEarly.status).toBe(400);
    expect(tooLate.status).toBe(400);
  });
});
