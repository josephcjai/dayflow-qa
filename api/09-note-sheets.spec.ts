/**
 * Added 2026-09-07 for the new multiple-categorized-note-sheets feature
 * (`schedule_weeks.note_sheets` JSONB, commit 6fb7686) — replacing the single weekly scratchpad
 * with up to N named/iconed sheets, one of which (`id: 'journal'`) still mirrors the legacy
 * `weekly_notes` column for backward compatibility. Default shape and sync behavior confirmed
 * live against the running stack while writing this file.
 *
 * One shared user for most of the file (via beforeAll), each test using its own `weekStart` so
 * sharing a user doesn't let one test's saved sheets bleed into another's "brand new week" checks.
 * Only the cross-user test needs two genuinely separate registrations. See
 * 07-date-bounds.spec.ts's header for why this matters for the suite's shared rate-limit budget.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerTestUser, type TestUser } from '../shared/testUser.js';

const DEFAULT_SHEET_IDS = ['journal', 'tech', 'backlog', 'scratchpad'];

describe('note sheets', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerTestUser();
  });

  it('a brand-new week with no saved notes synthesizes the 4 default sheets', async () => {
    const view = await user.client.get('/todos/week/2026-09-07');

    expect(view.status).toBe(200);
    expect(view.body.noteSheets).toHaveLength(4);
    expect(view.body.noteSheets.map((s: any) => s.id)).toEqual(DEFAULT_SHEET_IDS);
    expect(view.body.noteSheets.every((s: any) => s.isDefault === true)).toBe(true);
  });

  it('saving custom noteSheets round-trips every field exactly, including emoji icons', async () => {
    const weekStart = '2026-09-14';
    const sheets = [
      { id: 'journal', title: 'Weekly Journal', icon: '📓', content: 'Monday reflections', isDefault: true },
      { id: 'tech', title: 'Tech & Architecture', icon: '💻', content: 'Chose Postgres over Mongo', isDefault: true },
      { id: 'custom1', title: 'Sprint Retro', icon: '🚀', content: 'Went well: shipped on time', isDefault: false },
    ];

    const saved = await user.client.post('/todos/notes', { weekStart, noteSheets: sheets });
    expect(saved.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.noteSheets).toHaveLength(3);
    const journal = view.body.noteSheets.find((s: any) => s.id === 'journal');
    const custom = view.body.noteSheets.find((s: any) => s.id === 'custom1');
    expect(journal.content).toBe('Monday reflections');
    expect(journal.icon).toBe('📓'); // exercises real UTF-8 round-trip, not just ASCII
    expect(custom.title).toBe('Sprint Retro');
    expect(custom.isDefault).toBe(false);
  });

  it("the journal sheet's content syncs into the legacy `notes` field", async () => {
    const weekStart = '2026-09-21';
    await user.client.post('/todos/notes', {
      weekStart,
      noteSheets: [
        { id: 'journal', title: 'Weekly Journal', icon: '📓', content: 'This should appear in legacy notes too', isDefault: true },
        { id: 'tech', title: 'Tech & Architecture', icon: '💻', content: 'irrelevant to legacy notes', isDefault: true },
      ],
    });

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.notes).toBe('This should appear in legacy notes too');
  });

  it('legacy-only save (plain `notes` string, no noteSheets) still works for backward compatibility', async () => {
    const weekStart = '2026-09-28';
    const saved = await user.client.post('/todos/notes', { weekStart, notes: 'Just the old-style notes' });
    expect(saved.status).toBe(200);

    const view = await user.client.get(`/todos/week/${weekStart}`);
    expect(view.body.notes).toBe('Just the old-style notes');
    // No noteSheets were ever saved for this week, so the default set is synthesized again —
    // confirming a legacy-only save doesn't corrupt or block the sheets feature.
    expect(view.body.noteSheets.map((s: any) => s.id)).toEqual(DEFAULT_SHEET_IDS);
  });

  it("cross-user: B's GET never includes any of A's note sheet content", async () => {
    const weekStart = '2026-10-05';
    const userA = await registerTestUser();
    const userB = await registerTestUser();

    await userA.client.post('/todos/notes', {
      weekStart,
      noteSheets: [{ id: 'journal', title: 'Weekly Journal', icon: '📓', content: "A's private journal entry", isDefault: true }],
    });

    const bView = await userB.client.get(`/todos/week/${weekStart}`);
    const bJournal = bView.body.noteSheets.find((s: any) => s.id === 'journal');
    expect(bJournal?.content ?? '').not.toContain("A's private journal entry");
    expect(bView.body.notes ?? '').not.toContain("A's private journal entry");
  });
});
