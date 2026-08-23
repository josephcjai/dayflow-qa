import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Browser-level version of checklist item #5 — api/05-todos.spec.ts already covers the API
 * contract directly; this confirms the UI's localStorage cache reconciles with the server
 * correctly across a real reload (window.location.reload()), not just a component re-render.
 */
test.describe('todo UI state survives a real reload', () => {
  test('an added todo, its completed state, and a deleted sibling all survive reload', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.fill('#todoInput', 'Survive the reload');
    await page.locator('#todoInput').press('Enter');
    await page.fill('#todoInput', 'Delete me before reload');
    await page.locator('#todoInput').press('Enter');

    const keepItem = page.locator('#todoList li', { hasText: 'Survive the reload' });
    const deleteItem = page.locator('#todoList li', { hasText: 'Delete me before reload' });
    await expect(keepItem).toBeVisible();
    await expect(deleteItem).toBeVisible();

    await keepItem.locator('input[type="checkbox"]').check();
    // Confirmed against the live DOM: each todo's delete button has accessible name "✕", not
    // anything text-based — the earlier /delete|remove|🗑/i guess never matched.
    await deleteItem.getByRole('button', { name: '✕' }).click();
    // The app shows a confirm dialog before deleting (per index.html's deleteTodoConfirmModal).
    const confirmBtn = page.locator('#confirmDeleteTodoBtn');
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(deleteItem).toBeHidden();

    await page.reload();
    await page.click('.nav-btn[data-view="notes"]');

    await expect(page.locator('#todoList li', { hasText: 'Survive the reload' })).toBeVisible();
    await expect(
      page.locator('#todoList li', { hasText: 'Survive the reload' }).locator('input[type="checkbox"]')
    ).toBeChecked();
    await expect(page.locator('#todoList li', { hasText: 'Delete me before reload' })).toHaveCount(0);
  });

  test('weekly scratchpad notes survive reload', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    const noteText = 'Reflections that must survive a reload.';
    await page.fill('#weeklyNotesTextarea', noteText);
    await page.locator('#weeklyNotesTextarea').blur(); // most autosave-on-blur UIs commit here
    await expect(page.locator('#notesSavedStatus')).toBeVisible();

    await page.reload();
    await page.click('.nav-btn[data-view="notes"]');

    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue(noteText);
  });
});
