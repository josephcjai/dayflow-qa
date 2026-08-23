/**
 * Checklist item #5: add → toggle complete → delete a different item → re-fetch → confirm
 * exactly the expected state. This is a real, previously-confirmed bug class: deletes/completions
 * that looked fine in the same session silently reverted on the next fetch.
 */
import { describe, it, expect } from 'vitest';
import { registerTestUser } from '../shared/testUser.js';

const weekStart = '2026-08-31';

describe('todo & notes persistence round-trip', () => {
  it('checklist #5 — full add/toggle/delete round trip leaves exactly the expected state', async () => {
    const user = await registerTestUser();

    const itemA = await user.client.post('/todos/todo', { weekStart, text: 'Item A — will be completed' });
    const itemB = await user.client.post('/todos/todo', { weekStart, text: 'Item B — will be deleted' });
    const itemC = await user.client.post('/todos/todo', { weekStart, text: 'Item C — left untouched' });

    await user.client.patch(`/todos/${itemA.body.todo.id}`, { completed: true });
    await user.client.delete(`/todos/${itemB.body.todo.id}`);

    const finalView = await user.client.get(`/todos/week/${weekStart}`);
    const byId = (id: string) => finalView.body.todos.find((t: any) => t.id === id);

    expect(byId(itemA.body.todo.id)?.completed).toBe(true);
    expect(byId(itemB.body.todo.id)).toBeUndefined(); // gone, not resurrected
    expect(byId(itemC.body.todo.id)?.completed).toBe(false); // untouched, not accidentally flipped
    expect(finalView.body.todos).toHaveLength(2);
  });

  it('weekly scratchpad notes save and are returned verbatim on the next fetch', async () => {
    const user = await registerTestUser();
    const text = 'Weekly reflections: shipped the isolation suite.';

    const saved = await user.client.post('/todos/notes', { weekStart, notes: text });
    expect(saved.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.notes).toBe(text);
  });

  it('toggling completion back to false is respected (not a one-way flag)', async () => {
    const user = await registerTestUser();
    const item = await user.client.post('/todos/todo', { weekStart, text: 'Flip me twice' });

    await user.client.patch(`/todos/${item.body.todo.id}`, { completed: true });
    await user.client.patch(`/todos/${item.body.todo.id}`, { completed: false });

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.todos.find((t: any) => t.id === item.body.todo.id)?.completed).toBe(false);
  });
});
