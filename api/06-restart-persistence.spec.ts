/**
 * Checklist item #6: notes/todo persistence must survive a REAL restart of the database, not
 * just a re-fetch in the same process. Per the onboarding doc, this exact class of bug previously
 * passed against an in-memory fallback but silently failed against real Postgres due to a schema
 * mismatch — only a test against a freshly restarted real DB catches it.
 *
 * Restarts this repo's own postgres-qa and api-qa containers (never anything dev-owned) via
 * `docker compose restart`, sequenced deliberately — see the two things confirmed live while
 * building this suite, below. Both are documented here rather than only in a commit message
 * because they change what "just restart both containers" safely means for anyone touching this
 * file later.
 *
 * 1. Postgres uses a real named volume in docker-compose.test.yml, not tmpfs — tmpfs was tried
 *    first and does NOT reliably survive `docker compose restart` on Docker Desktop's WSL2
 *    backend (the data directory came back empty and Postgres silently re-ran initdb). See the
 *    comment on that volume in docker-compose.test.yml.
 * 2. api-qa is restarted AFTER postgres-qa is confirmed healthy again, not concurrently with it,
 *    and not left to reconnect on its own — because it doesn't: DayFlow's db.ts creates a `pg
 *    .Pool` with no `.on('error', ...)` listener, so when Postgres becomes briefly unreachable
 *    the pool's unhandled 'error' event crashes the whole Node process (confirmed live: api-qa
 *    exited with code 1 after a plain postgres-qa restart, with nothing else touching it). That
 *    is a real DayFlow robustness gap worth filing on its own — a transient DB hiccup should not
 *    take the whole API down — independent of whatever this test is actually checking. Restarting
 *    api-qa explicitly here is a working-around-a-known-bug step, not a requirement of the
 *    architecture; remove it if that gap ever gets fixed upstream and this still passes.
 *
 * Slower and more disruptive than the rest of the suite (it briefly stops the database and API),
 * so it's isolated in its own file — safe to skip locally with
 * `vitest run --exclude "**\/06-restart-persistence.spec.ts"` when iterating on something else.
 */
import { describe, it, expect } from 'vitest';
import { ENV } from '../shared/env.js';
import { registerTestUser } from '../shared/testUser.js';
import { restartQaContainers, waitForContainerHealthy } from '../shared/dockerControl.js';

const weekStart = '2026-09-07';

async function waitForApiHealthy(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${ENV.apiBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API did not become healthy within ${timeoutMs}ms`);
}

describe('persistence survives a real database restart', () => {
  it('checklist #6 — a note and a todo written before restart are still there after', async () => {
    const user = await registerTestUser();
    const noteText = `Restart persistence check ${Date.now()}`;
    const todo = await user.client.post('/todos/todo', { weekStart, text: 'Survive the restart' });
    await user.client.post('/todos/notes', { weekStart, notes: noteText });

    const before = await user.client.get(`/todos/week/${weekStart}`);
    expect(before.body.notes).toBe(noteText);

    restartQaContainers('postgres-qa');
    await waitForContainerHealthy('dayflow-qa-postgres');
    // See file header #2 — api-qa needs an explicit restart here, not just time to reconnect.
    restartQaContainers('api-qa');
    await waitForApiHealthy();

    const after = await user.client.get(`/todos/week/${weekStart}`);
    expect(after.status).toBe(200);
    expect(after.body.notes).toBe(noteText);
    expect(after.body.todos.some((t: any) => t.id === todo.body.todo.id)).toBe(true);
  }, 90_000);
});
