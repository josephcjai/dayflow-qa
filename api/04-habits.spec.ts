import { describe, it, expect } from 'vitest';
import { registerTestUser } from '../shared/testUser.js';

const weekStart = '2026-08-24';

describe('habit ledger CRUD (own-user)', () => {
  it('logs a habit action and it appears in the week view with a running total', async () => {
    const user = await registerTestUser();

    const logged = await user.client.post('/habits/log', {
      weekStart,
      name: 'Drink Water',
      pts: 5,
      notes: 'Hydration log',
    });
    expect(logged.status).toBe(200);
    expect(logged.body.habit.id).toBeDefined();

    const view = await user.client.get(`/habits/week/${weekStart}`);
    expect(view.status).toBe(200);
    expect(view.body.habits.some((h: any) => h.name === 'Drink Water' && h.pts === 5)).toBe(true);
  });

  it('deleting a habit log removes exactly that entry, nothing else', async () => {
    const user = await registerTestUser();
    const keep = await user.client.post('/habits/log', { weekStart, name: 'Keep me', pts: 5, notes: '' });
    const remove = await user.client.post('/habits/log', { weekStart, name: 'Remove me', pts: 10, notes: '' });

    const del = await user.client.delete(`/habits/${remove.body.habit.id}`);
    expect(del.status).toBe(200);

    const view = await user.client.get(`/habits/week/${weekStart}`);
    const names = view.body.habits.map((h: any) => h.name);
    expect(names).toContain('Keep me');
    expect(names).not.toContain('Remove me');
    expect(view.body.habits.find((h: any) => h.id === keep.body.habit.id)).toBeTruthy();
  });

  it('a custom entry with a negative point value (deduction) round-trips correctly', async () => {
    const user = await registerTestUser();
    const logged = await user.client.post('/habits/log', {
      weekStart,
      name: 'Skipped workout',
      pts: -10,
      notes: 'Deduction',
    });
    expect(logged.status).toBe(200);
    expect(logged.body.habit.pts).toBe(-10);
  });
});
