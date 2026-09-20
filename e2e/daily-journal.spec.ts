import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-17 for the new "Daily Journal" note sheet (commit 5330565, "feat(notes): add
 * date-specific Daily Journal and unify ES module versioning"). Confirmed against src/js/notes.js
 * and src/js/app.js in the pinned checkout:
 *
 * - Unlike the other 4 default sheets (one blob of content per week), `daily_journal` keys its
 *   content per calendar day (`sheet.dailyContent[isoDate]`) — the same sheet object, but the
 *   textarea shows different text depending on which day is currently selected (`STATE.selectedDate`).
 * - Switching the schedule view to Day mode auto-activates the Daily Journal tab; switching back
 *   to Week/Month reverts to the regular Weekly Journal tab if Daily Journal was the active one
 *   (app.js's `switchView`/the view-mode button handler).
 * - `flushCurrentNoteEditor()` is called before every date/view navigation specifically so content
 *   isn't lost when the active sheet or day changes out from under an unsaved edit.
 *
 * Only the day-switching mechanics are covered here; `e2e/note-sheets.spec.ts` covers the tab's
 * mere presence among the 5 defaults.
 *
 * UPDATE 2026-09-20 — commit 432ce86's fix for Finding 06 is real but PARTIAL, confirmed by a
 * live network-log diagnostic, not just re-running this file until it passed:
 *
 * `flushCurrentNoteEditor`/`flushNotesToApi` are now genuinely `async` and awaited by their own
 * caller before that caller changes STATE — that part of the original race is closed. But nearly
 * every UI action that touches notes (the date picker, the view-mode buttons, the notes nav tab,
 * blur) fires its OWN independent `flushCurrentNoteEditor()` call, each with its own `fetch`. A
 * diagnostic script logging every `/api/todos/notes` request/response confirmed that switching to
 * Day view + clicking the Notes tab BEFORE typing anything each fire their own (empty-content)
 * save, and typing + blurring fires yet another (real-content) save — three-plus independent,
 * unsequenced requests in quick succession. Nothing stops an EARLIER-fired-but-LATER-resolving
 * empty save from completing after a real one and overwriting it — awaiting inside one handler
 * doesn't order that handler's request relative to a DIFFERENT handler's already-in-flight one.
 * Reproduced at roughly the same ~30% rate as before the fix, across 10 repeated runs. This is
 * reported as Finding 06 being genuinely narrowed (the specific unawaited-call-before-navigation
 * bug is real and fixed) but NOT closed — see the 2026-09-20 report for the full account.
 *
 * The waits below are this test's own accommodation for the confirmed-still-present race — added
 * back after removing them once looked like it might be safe, and then wasn't (see git history).
 */

// Local date components, NOT `.toISOString()` — see the identical fix + explanation in
// e2e/month-view-data.spec.ts (confirmed live on this IST machine: a UTC round-trip silently
// rolls a local-midnight date back one day whenever the local offset is positive).
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test.describe('Daily Journal', () => {
  test('switching to Day view auto-activates the Daily Journal tab; switching back to Week reverts to Weekly Journal', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');
    await expect(page.locator('.note-sheet-tab[data-id="journal"]')).toHaveClass(/active/);

    await page.click('.view-mode-btn[data-mode="day"]');
    await expect(page.locator('.note-sheet-tab[data-id="daily_journal"]')).toHaveClass(/active/);

    await page.click('.view-mode-btn[data-mode="week"]');
    await expect(page.locator('.note-sheet-tab[data-id="journal"]')).toHaveClass(/active/);
    await expect(page.locator('.note-sheet-tab[data-id="daily_journal"]')).not.toHaveClass(/active/);
  });

  test("each day's journal content is isolated from other days and survives a reload", async ({ page }) => {
    await registerAndLoginViaUI(page);

    // Two dates comfortably apart (today ± 8, same pattern as e2e/time-lock.spec.ts) so this
    // never depends on what day of the week "today" happens to be.
    const dayA = new Date();
    dayA.setDate(dayA.getDate() + 8);
    const dayB = new Date();
    dayB.setDate(dayB.getDate() + 15);

    await page.fill('#weekDatePicker', isoDate(dayA));
    await page.click('.view-mode-btn[data-mode="day"]');
    await page.click('.nav-btn[data-view="notes"]');
    await expect(page.locator('.note-sheet-tab[data-id="daily_journal"]')).toHaveClass(/active/);
    // Let the setup navigation's own (empty-content) flush calls settle before typing — see the
    // file header. Without this, one of them can resolve AFTER the real content below is saved
    // and silently overwrite it with empty content.
    await page.waitForTimeout(1000);

    await page.fill('#weeklyNotesTextarea', 'Day A journal entry');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toBeVisible();
    await page.waitForTimeout(1000);

    // Jump to Day B via the date picker — still in Day view, still on the Daily Journal tab.
    await page.fill('#weekDatePicker', isoDate(dayB));
    await expect(page.locator('#weeklyNotesTextarea')).not.toHaveValue('Day A journal entry');
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('');
    await page.waitForTimeout(1000);

    await page.fill('#weeklyNotesTextarea', 'Day B journal entry');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toBeVisible();
    await page.waitForTimeout(1000);

    // Back to Day A: still isolated, not overwritten by Day B's edit.
    await page.fill('#weekDatePicker', isoDate(dayA));
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('Day A journal entry');

    await page.reload();
    await page.fill('#weekDatePicker', isoDate(dayA));
    await page.click('.view-mode-btn[data-mode="day"]');
    await page.click('.nav-btn[data-view="notes"]');
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('Day A journal entry');

    await page.fill('#weekDatePicker', isoDate(dayB));
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('Day B journal entry');
  });
});
