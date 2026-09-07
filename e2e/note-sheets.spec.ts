import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-07 for the new multiple-categorized-note-sheets feature (commit 6fb7686) —
 * browser-level companion to api/09-note-sheets.spec.ts's API-contract coverage. Tab markup
 * confirmed against src/js/notes.js's renderNoteSheetsTabs (dynamically rendered, not present in
 * static index.html) while writing this file.
 */
test.describe('note sheets', () => {
  test('the 4 default sheets are present for a brand-new week', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await expect(page.locator('.note-sheet-tab[data-id="journal"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="tech"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="backlog"]')).toBeVisible();
    await expect(page.locator('.note-sheet-tab[data-id="scratchpad"]')).toBeVisible();
    // Default sheets have no delete button (only custom ones do) — confirmed against notes.js.
    await expect(page.locator('.note-sheet-tab[data-id="journal"] .note-sheet-tab-delete')).toHaveCount(0);
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
