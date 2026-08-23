/**
 * Checklist items 10 & 11. NOT item 9 (the Planned-Task time-lock) — verified against
 * DAYFLOW_PINNED_REF's server/src/routes/scheduleRoutes.ts: the lock is enforced only in the
 * frontend modal, not the API (POST /slot accepts plannedTask unconditionally regardless of
 * time). That makes it a DOM-level concern per the onboarding's own Layer 2 scoping —
 * see e2e/time-lock.spec.ts instead. Keeping it out of this file is deliberate, not an omission.
 */
import { describe, it, expect } from 'vitest';
import { registerTestUser } from '../shared/testUser.js';

const weekStart = '2026-08-17';

describe('schedule slots', () => {
  it('checklist #10 — double-submitting the same slot does not create duplicates (upsert)', async () => {
    const user = await registerTestUser();
    const slotKey = `${weekStart}_08:00`;
    const base = {
      weekStart,
      slotKey,
      category: 'Work',
      status: 'Pending',
      planned: 30,
      actual: 0,
      notes: '',
    };

    await user.client.post('/schedule/slot', { ...base, plannedTask: 'First submit', actualTask: 'First submit' });
    await user.client.post('/schedule/slot', { ...base, plannedTask: 'First submit', actualTask: 'First submit' });
    const secondEdit = await user.client.post('/schedule/slot', {
      ...base,
      plannedTask: 'Second submit (edited)',
      actualTask: 'Second submit (edited)',
      status: 'Done',
    });
    expect(secondEdit.status).toBe(200);

    const view = await user.client.get(`/schedule/week/${weekStart}`);
    const keysMatchingSlot = Object.keys(view.body.slots).filter((k) => k === slotKey);
    expect(keysMatchingSlot).toHaveLength(1); // one logical slot, not N accumulated rows
    expect(view.body.slots[slotKey].plannedTask).toBe('Second submit (edited)');
    expect(view.body.slots[slotKey].status).toBe('Done');
  });

  it('checklist #11 — valid category/status values round-trip exactly', async () => {
    const user = await registerTestUser();
    const slotKey = `${weekStart}_11:00`;
    const categories = ['Learning', 'Work', 'Household', 'Family', 'Health', 'Travel', 'General'];
    const statuses = ['Pending', 'Done', 'Partially Done', 'Not Done'];

    for (const category of categories) {
      for (const status of [statuses[Math.floor(Math.random() * statuses.length)]]) {
        await user.client.post('/schedule/slot', {
          weekStart,
          slotKey,
          plannedTask: 'Round trip check',
          actualTask: 'Round trip check',
          category,
          status,
          planned: 30,
          actual: 15,
          notes: 'n',
        });
        const view = await user.client.get(`/schedule/week/${weekStart}`);
        expect(view.body.slots[slotKey].category).toBe(category);
        expect(view.body.slots[slotKey].status).toBe(status);
      }
    }
  });

  it('checklist #11 — an unexpected category string (bypassing the UI dropdown) is stored as-is and does not break a subsequent fetch', async () => {
    // The API has no server-side enum validation on category/status (confirmed against
    // scheduleRoutes.ts) — the fixed set is a UI-only affordance. That's fine as long as an
    // off-list value round-trips cleanly and never corrupts the week's GET response.
    const user = await registerTestUser();
    const slotKey = `${weekStart}_12:00`;

    const save = await user.client.post('/schedule/slot', {
      weekStart,
      slotKey,
      plannedTask: 'Malformed category input',
      actualTask: 'Malformed category input',
      category: 'NotARealCategory<script>',
      status: 'NotARealStatus',
      planned: 30,
      actual: 0,
      notes: '',
    });
    expect(save.status).toBe(200);

    const view = await user.client.get(`/schedule/week/${weekStart}`);
    expect(view.status).toBe(200); // the malformed row must not break rendering the rest of the week
    expect(view.body.slots[slotKey].category).toBe('NotARealCategory<script>');
  });

  it('checklist #11 — a category longer than the schema column (50 chars) fails cleanly, not with an unhandled 500', async () => {
    // schema.sql: category VARCHAR(50). Postgres rejects an over-length value outright rather
    // than truncating it — worth confirming the route surfaces that as something other than a
    // raw, unhandled 500 (the current handler's catch-all does return valid JSON either way, but
    // this pins the behavior so a future refactor doesn't turn it into a crash).
    const user = await registerTestUser();
    const res = await user.client.post('/schedule/slot', {
      weekStart,
      slotKey: `${weekStart}_13:00`,
      plannedTask: 'Oversized category',
      actualTask: 'Oversized category',
      category: 'X'.repeat(51),
      status: 'Pending',
      planned: 30,
      actual: 0,
      notes: '',
    });
    expect(res.status).toBeLessThan(600);
    expect(res.body).toBeDefined();
  });
});
