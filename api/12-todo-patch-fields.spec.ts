/**
 * Added 2026-09-09 for the rewritten `PATCH /api/todos/:id` (commit d922a30) — it went from a
 * fixed completed/dueDate branch to a general dynamic-field updater also covering `text`,
 * `priority`, and `category`, built by assembling a `fields[]`/`values[]` array and tracking
 * `$1, $2, ...` positions by hand. That kind of manually-indexed SQL-building is exactly the sort
 * of code that's easy to get subtly wrong in one combination and not another — worth testing each
 * field alone AND several together, not just individually. Every case below was confirmed live.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerTestUser, type TestUser } from '../shared/testUser.js';

const weekStart = '2026-09-09';

describe('PATCH /api/todos/:id — extended fields (text, priority, category)', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerTestUser();
  });

  it('can update text alone, leaving priority/category/completed/dueDate untouched', async () => {
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: 'Original text',
      priority: 'High',
      category: 'Work',
      dueDate: '2026-09-20',
    });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, { text: 'Updated text' });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    const item = view.body.todos.find((t: any) => t.id === id);
    expect(item.text).toBe('Updated text');
    expect(item.priority).toBe('High');
    expect(item.category).toBe('Work');
    expect(item.dueDate).toBe('2026-09-20');
    expect(item.completed).toBe(false);
  });

  it('rejects empty (whitespace-only) text with 400, leaving the existing text untouched', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'Keep me' });
    const id = created.body.todo.id;

    const badPatch = await user.client.patch(`/todos/${id}`, { text: '   ' });
    expect(badPatch.status).toBe(400);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.text).toBe('Keep me');
  });

  it('can update priority alone, and rejects a priority outside High/Medium/Low', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'Priority check' });
    const id = created.body.todo.id;

    const good = await user.client.patch(`/todos/${id}`, { priority: 'Low' });
    expect(good.status).toBe(200);
    let view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.priority).toBe('Low');

    const bad = await user.client.patch(`/todos/${id}`, { priority: 'Urgent' });
    expect(bad.status).toBe(400);
    view = await user.client.get(`/todos/week/${weekStart}`);
    // Still 'Low' — the rejected patch must not have partially applied.
    expect(view.body.todos.find((t: any) => t.id === id)?.priority).toBe('Low');
  });

  it('can update category alone', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'Category check' });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, { category: 'Learning' });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === id)?.category).toBe('Learning');
  });

  it('can update all five fields in a single PATCH at once', async () => {
    const created = await user.client.post('/todos/todo', { weekStart, text: 'Everything at once' });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, {
      text: 'Now updated',
      priority: 'High',
      category: 'Family',
      completed: true,
      dueDate: '2026-09-25',
    });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    const item = view.body.todos.find((t: any) => t.id === id);
    expect(item).toMatchObject({
      text: 'Now updated',
      priority: 'High',
      category: 'Family',
      completed: true,
      dueDate: '2026-09-25',
    });
  });

  it('clearing dueDate works correctly alongside other fields in the same PATCH', async () => {
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: 'Clear due date plus category',
      dueDate: '2026-09-20',
    });
    const id = created.body.todo.id;

    const patch = await user.client.patch(`/todos/${id}`, { dueDate: null, category: 'Health' });
    expect(patch.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    const item = view.body.todos.find((t: any) => t.id === id);
    expect(item.dueDate).toBeNull();
    expect(item.category).toBe('Health');
  });

  it('a non-UUID-shaped id is rejected with 404, not a 500 from a Postgres type-cast error', async () => {
    const res = await user.client.patch('/todos/not-a-real-uuid', { text: 'x' });
    expect(res.status).toBe(404);
  });

  it("cross-user: B patching A's todo's text/priority/category by known ID does not change it", async () => {
    const userB = await registerTestUser();
    const created = await user.client.post('/todos/todo', {
      weekStart,
      text: "A's original text",
      priority: 'Low',
      category: 'General',
    });
    const id = created.body.todo.id;

    await userB.client.patch(`/todos/${id}`, { text: 'Hijacked', priority: 'High', category: 'Work' });

    const view = await user.client.get(`/todos/week/${weekStart}`);
    const item = view.body.todos.find((t: any) => t.id === id);
    expect(item.text).toBe("A's original text");
    expect(item.priority).toBe('Low');
    expect(item.category).toBe('General');
  });
});
