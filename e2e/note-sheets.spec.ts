import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-07 for the new multiple-categorized-note-sheets feature (commit 6fb7686) —
 * browser-level companion to api/09-note-sheets.spec.ts's API-contract coverage. Tab markup
 * confirmed against src/js/notes.js's renderNoteSheetsTabs (dynamically rendered, not present in
 * static index.html) while writing this file.
 *
 * UPDATE 2026-09-17 (commit 5330565, "feat(notes): add date-specific Daily Journal"): a 5th
 * default tab, `daily_journal`, now appears alongside the original 4 — but ONLY client-side.
 * Confirmed against source: the server's own `defaultSheets()` in todoRoutes.ts was NOT updated
 * and still returns just the original 4 — the frontend's `getWeekNoteSheets()` (state.js/notes.js)
 * patches the 5th one in locally on every read, for both brand-new weeks and old ones being
 * upgraded. That's why api/09-note-sheets.spec.ts (which asserts on the raw API response) did NOT
 * need updating, while this file does — see the "also noticed" section of the 2026-09-17 report
 * for the full account of why that split isn't a bug, just two lists that now need to be read
 * together to know the real default set.
 */
test.describe('note sheets', () => {
  test('the 5 default sheets (including Daily Journal) are present for a brand-new week', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await expect(page.locator('.note-sheet-tab[data-id="journal"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="daily_journal"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="tech"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="backlog"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="scratchpad"]')).toBeVisible();
    // Default sheets have no delete button (only custom ones do) — confirmed against notes.js.
    await expect(page.locator('.note-sheet-tab[data-id="journal"] .note-sheet-tab-delete')).toHaveCount(0);
    await expect(page.locator('.note-sheet-tab[data-id="daily_journal"] .note-sheet-tab-delete')).toHaveCount(0);
  });

  test('creating a custom sheet, writing content, and reloading keeps it — separately from other sheets', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.click('#addNoteSheetBtn');
    await expect(page.locator('#addNoteSheetModal')).toBeVisible();
    await page.fill('#newSheetTitleInput', 'Sprint Retro');
    await page.click('.sheet-icon-option[data-icon="🚀"]');
    await page.click('#confirmAddSheetBtn');

    const customTab = page.locator('.note-sheet-tab', { hasText: 'Sprint Retro' });
    await expect(customTab).toBeVisible();

    // Switching to the new sheet and writing content shouldn't touch the journal sheet's own text.
    await page.fill('#weeklyNotesTextarea', 'Journal entry before switching').catch(() => {});
    await customTab.click();
    await page.fill('#weeklyNotesTextarea', 'Went well: shipped on time');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toBeVisible();

    await page.click('.note-sheet-tab[data-id="journal"]');
    await expect(page.locator('#weeklyNotesTextarea')).not.toHaveValue('Went well: shipped on time');

    await page.reload();
    await page.click('.nav-btn[data-view="notes"]');
    await page.locator('.note-sheet-tab', { hasText: 'Sprint Retro' }).click();
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('Went well: shipped on time');
  });

  test('deleting a custom sheet removes its tab', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.click('#addNoteSheetBtn');
    await page.fill('#newSheetTitleInput', 'Temporary Sheet');
    await page.click('#confirmAddSheetBtn');

    const tab = page.locator('.note-sheet-tab', { hasText: 'Temporary Sheet' });
    await expect(tab).toBeVisible();

    await tab.locator('.note-sheet-tab-delete').click();
    await expect(page.locator('#deleteNoteSheetConfirmModal')).toBeVisible();
    await page.click('#confirmDeleteNoteSheetBtn');

    await expect(page.locator('.note-sheet-tab', { hasText: 'Temporary Sheet' })).toHaveCount(0);
  });
});
