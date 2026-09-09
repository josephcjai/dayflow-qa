import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

test.describe('schedule grid view modes', () => {
  test('switching Day / Week / Month updates the active button and grid content', async ({ page }) => {
    await registerAndLoginViaUI(page);

    await expect(page.locator('.view-mode-btn[data-mode="week"]')).toHaveClass(/active/);
    await expect(page.locator('#gridWrapper')).toBeVisible();

    await page.click('.view-mode-btn[data-mode="day"]');
    await expect(page.locator('.view-mode-btn[data-mode="day"]')).toHaveClass(/active/);

    await page.click('.view-mode-btn[data-mode="month"]');
    await expect(page.locator('.view-mode-btn[data-mode="month"]')).toHaveClass(/active/);
    await expect(page.locator('#monthViewContainer')).toBeVisible();

    await page.click('.view-mode-btn[data-mode="week"]');
    await expect(page.locator('.view-mode-btn[data-mode="week"]')).toHaveClass(/active/);
    await expect(page.locator('#gridWrapper')).toBeVisible();
  });

  test('the current 30-minute slot is highlighted as "NOW" in Week view', async ({ page }) => {
    await registerAndLoginViaUI(page);
    // grid.js marks the live slot with the `current-active-slot` class on its <td> — confirmed
    // against src/js/grid.js in the pinned checkout.
    await expect(page.locator('td.current-active-slot')).toHaveCount(1);
  });

  test('the category filter narrows the grid to a single category', async ({ page }) => {
    await registerAndLoginViaUI(page);

    // Jump to next week first — the *current* week's first slot cell (Monday 4:00 AM) is in the
    // past relative to "now" for most of the week, and a past slot's Planned Task is locked (see
    // e2e/time-lock.spec.ts), which made #plannedTaskInput unfillable here. An entirely future
    // week has no such slots. Confirmed live while fixing this spec.
    await page.click('#nextWeekBtn');

    // Create a Work slot via the modal so the filter has something to prove.
    const workCell = page.locator('td.slot-cell').first();
    // dblclick, not click — confirmed against grid.js (commit d922a30, 2026-09-09): a single
    // click on a cell now only *selects* it (first click) or opens the modal if it was already
    // selected (second click), supporting the new copy/paste/multi-select cell interactions.
    // dblclick's own handler always opens the modal directly regardless of selection state.
    await workCell.dblclick();
    await page.fill('#plannedTaskInput', 'Filtered Work Task');
    await page.fill('#actualTaskInput', 'Filtered Work Task');
    await page.selectOption('#taskCategorySelect', 'Work');
    // Confirmed against the live DOM: the save button's accessible name is "Save Slot Task".
    await page.getByRole('button', { name: 'Save Slot Task' }).click();
    // NOT toBeHidden() here: confirmed against src/css/styles.css that .modal-overlay is always
    // `display: flex` and toggles closed via an `.active` class controlling opacity/pointer-events
    // (for the open/close transition), never display:none. Playwright's visibility check only
    // looks at layout (display/visibility/empty box), so it never considered this "hidden" even
    // though the modal is genuinely, visibly gone on screen — confirmed via screenshot while
    // debugging this. Assert on the class the app actually toggles instead.
    await expect(page.locator('#taskModal')).not.toHaveClass(/active/);

    await page.selectOption('#categoryFilter', 'Work');
    await expect(page.locator('td.slot-cell[data-slot-key]').first()).toBeVisible();

    await page.selectOption('#categoryFilter', 'ALL');
  });
});
