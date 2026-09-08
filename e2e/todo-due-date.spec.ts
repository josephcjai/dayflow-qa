import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-07 for the new todo due-date UI (commit 6fb7686) — browser-level companion to
 * api/08-todo-due-dates.spec.ts's API-contract coverage. Confirmed against the live DOM
 * (src/js/notes.js's badge classes, index.html's quick-set buttons) while writing this file.
 */
test.describe('todo due date', () => {
  test('setting due date to "Today" via the quick button shows a Due Today badge', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.fill('#todoInput', 'Ship the due-date feature');
    await page.click('#todoDueTodayBtn');
    await expect(page.locator('#todoDueDateInput')).not.toHaveValue('');
    await expect(page.locator('#todoDueClearBtn')).toBeVisible();

    await page.locator('#todoInput').press('Enter');

    const item = page.locator('#todoList li', { hasText: 'Ship the due-date feature' });
    await expect(item.locator('.todo-due-today')).toBeVisible();
    await expect(item.locator('.todo-due-today')).toContainText('Due Today');
  });

  test('the Clear button empties the due-date field before it\'s submitted', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.fill('#todoInput', 'Change my mind about the due date');
    await page.click('#todoDueTodayBtn');
    await expect(page.locator('#todoDueClearBtn')).toBeVisible();

    await page.click('#todoDueClearBtn');
    await expect(page.locator('#todoDueDateInput')).toHaveValue('');

    await page.locator('#todoInput').press('Enter');
    const item = page.locator('#todoList li', { hasText: 'Change my mind about the due date' });
    await expect(item.locator('.todo-due-badge')).toHaveCount(0);
  });

  test('setting due date to "Tomorrow" shows a Due Tomorrow badge', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.fill('#todoInput', 'Plan for tomorrow');
    await page.click('#todoDueTomorrowBtn');
    // Wait for the click's UI update to actually land before submitting — confirmed live that
    // pressing Enter immediately after the click can race the button handler under load and the
    // submit gets dropped (the todo never appears at all). Same fix as the "Today" test above.
    await expect(page.locator('#todoDueDateInput')).not.toHaveValue('');
    await page.locator('#todoInput').press('Enter');

    const item = page.locator('#todoList li', { hasText: 'Plan for tomorrow' });
    await expect(item.locator('.todo-due-tomorrow')).toBeVisible();
    await expect(item.locator('.todo-due-tomorrow')).toContainText('Due Tomorrow');
  });

  test('a todo with no due date set shows no due-date badge at all', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');

    await page.fill('#todoInput', 'No due date here');
    await page.locator('#todoInput').press('Enter');

    const item = page.locator('#todoList li', { hasText: 'No due date here' });
    await expect(item.locator('.todo-due-badge')).toHaveCount(0);
  });
});
