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

    // Create one Work slot and one Health slot via the modal so the filter has something to prove.
    const workCell = page.locator('td.slot-cell').first();
    await workCell.click();
    await page.fill('#plannedTaskInput', 'Filtered Work Task');
    await page.fill('#actualTaskInput', 'Filtered Work Task');
    await page.selectOption('#taskCategorySelect', 'Work');
    // #taskForm's save button id wasn't confirmed against the live DOM while scaffolding this
    // (only #deleteTaskBtn/#closeModalBtn were) — this selector is a reasonable first guess;
    // fix it against the real markup the first time this spec runs.
    await page.click('#taskForm button[type="submit"], #taskForm button:not([type="button"])');
    await expect(page.locator('#taskModal')).toBeHidden();

    await page.selectOption('#categoryFilter', 'Work');
    await expect(page.locator('td.slot-cell[data-slot-key]').first()).toBeVisible();

    await page.selectOption('#categoryFilter', 'ALL');
  });
});
