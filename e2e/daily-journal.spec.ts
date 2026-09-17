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
 * A note on the explicit waits below: confirmed against source (app.js's `flushNotesToApi` and
 * notes.js's `flushCurrentNoteEditor`) that every notes save — on the 600ms autosave debounce AND
 * on blur — fires `ApiClient.saveNotes(...)` WITHOUT awaiting it, and shows "Saved" the instant the
 * request is sent, not when it completes. Navigating to another day/week immediately after
 * doesn't wait for that in-flight write, so it can race the next day's own GET and occasionally
 * lose the edit — reproduced live while writing this file (intermittently, roughly 1 run in 3) and
 * reported as Finding 06 rather than treated as a test flake. The explicit pause below is this
 * test's own accommodation for that real race so it reliably tests day-isolation itself instead of
 * incidentally re-rolling that race on every run.
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

    await page.fill('#weeklyNotesTextarea', 'Day A journal entry');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toBeVisible();
    // See the file header: the save this just triggered isn't awaited by the app itself — give it
    // a moment to actually reach the server before navigating away (Finding 06).
    await page.waitForTimeout(800);

    // Jump to Day B via the date picker — still in Day view, still on the Daily Journal tab.
    await page.fill('#weekDatePicker', isoDate(dayB));
    await expect(page.locator('#weeklyNotesTextarea')).not.toHaveValue('Day A journal entry');
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('');

    await page.fill('#weeklyNotesTextarea', 'Day B journal entry');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toBeVisible();
    await page.waitForTimeout(800);

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
