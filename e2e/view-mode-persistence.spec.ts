import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-09 for the new "persist schedule view mode" feature (commit d922a30, "feat:
 * persist schedule view mode (day/week/month) ... and enable week header day switching").
 * Confirmed against src/js/app.js: purely a `localStorage` preference
 * (`dayflow_active_view`/`dayflow_schedule_view_mode`, namespaced per user), no API surface at
 * all — this is exactly the kind of thing that can only be verified by actually reloading a real
 * browser, which is what e2e/ is for; there is no corresponding api/ coverage for this one.
 */
test.describe('schedule view mode persists across reload', () => {
  test('switching to Day view and reloading keeps Day view active, not the Week default', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await expect(page.locator('.view-mode-btn[data-mode="week"]')).toHaveClass(/active/);

    await page.click('.view-mode-btn[data-mode="day"]');
    await expect(page.locator('.view-mode-btn[data-mode="day"]')).toHaveClass(/active/);

    await page.reload();

    await expect(page.locator('.view-mode-btn[data-mode="day"]')).toHaveClass(/active/);
    await expect(page.locator('.view-mode-btn[data-mode="week"]')).not.toHaveClass(/active/);
  });

  test('switching to Month view and reloading keeps Month view active', async ({ page }) => {
    await registerAndLoginViaUI(page);

    await page.click('.view-mode-btn[data-mode="month"]');
    await expect(page.locator('.view-mode-btn[data-mode="month"]')).toHaveClass(/active/);

    await page.reload();

    await expect(page.locator('.view-mode-btn[data-mode="month"]')).toHaveClass(/active/);
  });
});
