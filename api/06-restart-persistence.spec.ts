/**
 * Checklist item #6: notes/todo persistence must survive a REAL restart of the database, not
 * just a re-fetch in the same process. Per the onboarding doc, this exact class of bug previously
 * passed against an in-memory fallback but silently failed against real Postgres due to a schema
 * mismatch — only a test against a freshly restarted real DB catches it.
 *
 * Restarts ONLY this repo's own postgres-qa container (never anything dev-owned, never api-qa) via
 * `docker compose restart`. Two things worth knowing, both confirmed live:
 *
 * 1. Postgres uses a real named volume in docker-compose.test.yml, not tmpfs — tmpfs was tried
 *    first and does NOT reliably survive `docker compose restart` on Docker Desktop's WSL2
 *    backend (the data directory came back empty and Postgres silently re-ran initdb). See the
 *    comment on that volume in docker-compose.test.yml.
 * 2. This test used to also explicitly restart api-qa after postgres-qa, to work around a real bug
 *    (db.ts's `pg.Pool` had no `.on('error', ...)` listener, so a Postgres restart crashed the
 *    whole API process — filed as Finding 03, 2026-08-23 report). That's now fixed upstream
 *    (confirmed live: api-qa stays up and reconnects on its own through a postgres-qa-only
 *    restart) — the api-qa restart step was removed. If it ever regresses, THIS test is what
 *    would catch it: the poll below would time out waiting for the API to come back, since
 *    nothing here restarts it for you anymore.
 *
 * Slower and more disruptive than the rest of the suite (it briefly stops the database), so it's
 * isolated in its own file — safe to skip locally with
 * `vitest run --exclude "**\/06-restart-persistence.spec.ts"` when iterating on something else.
 */
import { describe, it, expect } from 'vitest';
import { registerTestUser } from '../shared/testUser.js';
import { restartQaContainers, waitForContainerHealthy } from '../shared/dockerControl.js';

const weekStart = '2026-09-07';

async function pollUntilNotesMatch(
  getNotes: () => Promise<string | undefined>,
  expected: string,
  timeoutMs = 30_000
): Promise<string | undefined> {
  const start = Date.now();
  let last: string | undefined;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await getNotes();
      if (last === expected) return last;
    } catch {
      // pool still reconnecting — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
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

    const notesAfter = await pollUntilNotesMatch(async () => {
      const res = await user.client.get(`/todos/week/${weekStart}`);
      return res.body.notes;
    }, noteText);

    expect(notesAfter).toBe(noteText);

    const after = await user.client.get(`/todos/week/${weekStart}`);
    expect(after.body.todos.some((t: any) => t.id === todo.body.todo.id)).toBe(true);
  }, 60_000);
});
