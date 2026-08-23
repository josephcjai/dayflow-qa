/**
 * Cross-user isolation — the highest-value file in this repo (docs/TECHNICAL_PLAN.md Phase 1,
 * checklist items 3 & 4). Every table that stores user data traces back to a user_id; every
 * query that reads/writes it must filter by the authenticated caller. Every new endpoint the dev
 * team ships gets an isolation case added here before anything else.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../shared/apiClient.js';
import { registerTestUser, type TestUser } from '../shared/testUser.js';

const api = new ApiClient();
const weekStart = '2026-08-10'; // a Monday — arbitrary, fixed so slot/habit/todo shapes are stable

describe('unauthenticated access — checklist item #3', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', `/schedule/week/${weekStart}`],
    ['POST', '/schedule/slot'],
    ['GET', `/habits/week/${weekStart}`],
    ['POST', '/habits/log'],
    ['GET', `/todos/week/${weekStart}`],
    ['POST', '/todos/todo'],
  ];

  it.each(protectedRoutes)('%s %s returns 401 with no Authorization header', async (method, path) => {
    const res = await api.request(method, path, method === 'GET' ? undefined : {});
    expect(res.status).toBe(401);
  });

  it('a spoofed identity header with no valid token is still rejected', async () => {
    const res = await api.get(`/schedule/week/${weekStart}`, {
      'X-User-Id': 'not-a-real-mechanism-in-this-api',
    });
    expect(res.status).toBe(401);
  });
});

describe('cross-user isolation — checklist item #4', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await registerTestUser();
    userB = await registerTestUser();
  });

  it("B's schedule GET never includes any of A's slots", async () => {
    const slotKey = `${weekStart}_09:00`;
    await userA.client.post('/schedule/slot', {
      weekStart,
      slotKey,
      plannedTask: "A's private plan",
      actualTask: "A's private plan",
      category: 'Work',
      status: 'Pending',
      planned: 30,
      actual: 0,
      notes: '',
    });

    const bView = await userB.client.get(`/schedule/week/${weekStart}`);
    expect(bView.status).toBe(200);
    expect(bView.body.slots?.[slotKey]).toBeUndefined();
  });

  it("B's habit GET never includes any of A's habit logs", async () => {
    await userA.client.post('/habits/log', {
      weekStart,
      name: "A's private habit",
      pts: 5,
      notes: '',
    });

    const bView = await userB.client.get(`/habits/week/${weekStart}`);
    expect(bView.status).toBe(200);
    expect(bView.body.habits?.some((h: any) => h.name === "A's private habit")).toBe(false);
  });

  it("B's todo GET never includes any of A's todos or notes", async () => {
    await userA.client.post('/todos/todo', { weekStart, text: "A's private todo" });
    await userA.client.post('/todos/notes', { weekStart, notes: "A's private weekly notes" });

    const bView = await userB.client.get(`/todos/week/${weekStart}`);
    expect(bView.status).toBe(200);
    expect(bView.body.todos?.some((t: any) => t.text === "A's private todo")).toBe(false);
    expect(bView.body.notes ?? '').not.toContain("A's private weekly notes");
  });

  it("B deleting A's schedule slot by a guessed/known slotKey does not remove it", async () => {
    const slotKey = `${weekStart}_10:00`;
    await userA.client.post('/schedule/slot', {
      weekStart,
      slotKey,
      plannedTask: 'Protect me',
      actualTask: 'Protect me',
      category: 'Work',
      status: 'Pending',
      planned: 30,
      actual: 0,
      notes: '',
    });

    await userB.client.delete('/schedule/slot', { weekStart, slotKey });

    const aView = await userA.client.get(`/schedule/week/${weekStart}`);
    expect(aView.body.slots?.[slotKey]?.plannedTask).toBe('Protect me');
  });

  it("B deleting A's todo by known ID does not remove it (data must survive regardless of response code)", async () => {
    const created = await userA.client.post('/todos/todo', { weekStart, text: 'Do not delete me' });
    const todoId = created.body.todo.id;

    const deleteAttempt = await userB.client.delete(`/todos/${todoId}`);

    const aView = await userA.client.get(`/todos/week/${weekStart}`);
    const stillThere = aView.body.todos?.find((t: any) => t.id === todoId);
    expect(stillThere).toBeTruthy();
    expect(stillThere.text).toBe('Do not delete me');

    // The onboarding checklist (#4) specifies this must be REJECTED, not silently no-op'd.
    // As of DAYFLOW_PINNED_REF, the route ignores rowCount and always responds 200 "deleted"
    // even when the WHERE clause (scoped to the caller's own weeks) matched nothing — data
    // isolation holds, but the response is misleading. If this assertion is red, it's not a
    // flaky test: it's confirming a real gap against the dev team's own stated contract for
    // this behavior. File it — see docs/TECHNICAL_PLAN.md Phase 1 checklist item #4 and
    // docs/GROUND_RULES.md §3 for how to report it.
    expect(deleteAttempt.status).not.toBe(200);
  });

  it("B patching A's todo (toggle complete) by known ID does not change it", async () => {
    const created = await userA.client.post('/todos/todo', { weekStart, text: 'Leave my state alone' });
    const todoId = created.body.todo.id;

    await userB.client.patch(`/todos/${todoId}`, { completed: true });

    const aView = await userA.client.get(`/todos/week/${weekStart}`);
    const stillThere = aView.body.todos?.find((t: any) => t.id === todoId);
    expect(stillThere?.completed).toBe(false);
  });

  it("B deleting A's habit log by known ID does not remove it", async () => {
    const created = await userA.client.post('/habits/log', {
      weekStart,
      name: 'Protected habit entry',
      pts: 5,
      notes: '',
    });
    const habitId = created.body.habit.id;

    await userB.client.delete(`/habits/${habitId}`);

    const aView = await userA.client.get(`/habits/week/${weekStart}`);
    expect(aView.body.habits?.some((h: any) => h.id === habitId)).toBe(true);
  });
});
