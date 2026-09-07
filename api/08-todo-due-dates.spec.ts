/**
 * Added 2026-09-07 for the new `dueDate` field on todos (`todo_items.due_date`, commit 6fb7686).
 * Every assertion here was confirmed against the live stack while writing this file — including
 * the regression flagged below, which is a real, reproducible finding, not a guess from source.
 *
 * One shared user for most of the file (via beforeAll) — each test creates its own independently
 * identified todo, so there's no interference between them; only the cross-user test at the end
 * genuinely needs two separate registrations. See 07-date-bounds.spec.ts's header for why this
 * matters for the whole numbered suite's shared rate-limit budget.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerTestUser, type TestUser } from '../shared/testUser.js';

const weekStart = '2026-09-07';

describe('todo due dates', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerTestUser();
  });

  it('creating a todo with a valid dueDate round-trips it exactly', async () => {
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: 'Ship the release notes',
      dueDate: '2026-09-15',
    });
    expect(created.status).toBe(200);
    expect(created.body.todo.dueDate).toBe('2026-09-15');

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === created.body.todo.id)?.dueDate).toBe('2026-09-15');
  });

  it('creating a todo with no dueDate at all defaults it to null, not an error', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'No due date' });
    expect(created.status).toBe(200);
    expect(created.body.todo.dueDate).toBeNull();
  });

  it('creating a todo with an out-of-range or malformed dueDate is rejected with 400', async () => {
    const tooEarly = await user.client.post('/todos/todo', {
      weekStart,
      text: 'x',
      dueDate: '1799-12-31',
    });
    const malformed = await user.client.post('/todos/todo', { weekStart, text: 'x', dueDate: 'soon' });
    expect(tooEarly.status).toBe(400);
    expect(malformed.status).toBe(400);
  });

  it('PATCH can set a dueDate on an existing todo without touching its completed state', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'Add a due date later' });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, { dueDate: '2026-09-20' });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    const item = view.body.todos.find((t: any) => t.id === id);
    expect(item.dueDate).toBe('2026-09-20');
    expect(item.completed).toBe(false); // untouched — this PATCH never mentioned `completed`
  });

  it('PATCH with dueDate: null clears an existing due date', async () => {
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: 'Clear my due date',
      dueDate: '2026-09-20',
    });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, { dueDate: null });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.dueDate).toBeNull();
  });

  it('PATCH rejects an out-of-range dueDate (400), leaving the existing value untouched', async () => {
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: 'Keep my valid due date',
      dueDate: '2026-09-20',
    });
    const id = created.body.todo.id;

    const badPatch = await user.client.patch(`/todos/${id}`, { dueDate: '2201-01-01' });
    expect(badPatch.status).toBe(400);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.dueDate).toBe('2026-09-20');
  });

  it(
    'REGRESSION — an empty PATCH body silently resets completed to false, even if it was true ' +
      "(confirmed live 2026-09-07: PATCH /todos/:id with {} takes the handler's final `else` " +
      'branch, which unconditionally runs `SET is_completed = !!completed` — since `completed` is ' +
      '`undefined` there, that\'s `SET is_completed = false`, unconditionally. Any PATCH that omits ' +
      'both `completed` and `dueDate` — an empty body, a client bug, a future call site that only ' +
      "means to touch something else — silently un-completes the item. This is a real, reproducible " +
      'app behavior as of commit 6fb7686, not a test bug; see the report for the suggested fix.)',
    async () => {
      const created = await user.client.post('/todos/todo', { weekStart, text: 'Do not un-complete me' });
      const id = created.body.todo.id;

      const markDone = await user.client.patch(`/todos/${id}`, { completed: true });
      expect(markDone.status).toBe(200);
      const afterMarkDone = await user.client.get(`/todos/week/${weekStart}`);
      expect(afterMarkDone.body.todos.find((t: any) => t.id === id)?.completed).toBe(true);

      // An empty patch body — no `completed`, no `dueDate` — should be a no-op.
      await user.client.patch(`/todos/${id}`, {});

      const afterEmptyPatch = await user.client.get(`/todos/week/${weekStart}`);
      const item = afterEmptyPatch.body.todos.find((t: any) => t.id === id);
      // Expressing the intended behavior, not today's actual behavior — currently red, and that's
      // the point: it documents the regression until fixed, rather than asserting the bug itself.
      expect(item?.completed).toBe(true);
    }
  );

  it("cross-user: B patching A's todo's dueDate by known ID does not change it", async () => {
    const userA = await registerTestUser();
    const userB = await registerTestUser();
    const created = await userA.client.post('/todos/todo', {
      weekStart,
      text: "A's todo",
      dueDate: '2026-09-20',
    });
    const id = created.body.todo.id;

    await userB.client.patch(`/todos/${id}`, { dueDate: '2026-01-01' });

    const view = await userA.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.dueDate).toBe('2026-09-20');
  });
});
