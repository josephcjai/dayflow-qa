import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-20 for commit 7dfa287 ("add dirty check to prevent blocking saves on navigation
 * and serialize ApiClient notes queue"), fixing Finding 08 and part of Finding 06.
 *
 * - The first test is a permanent regression guard for Finding 08: pure navigation must not fire
 *   `POST /api/todos/notes` at all. Confirmed against the fix with a network-trace diagnostic
 *   (6 navigation clicks, 0 saves; it was 6/6 before).
 * - The second is an EXPECTED-FAILURE marker (`test.fail`) for Finding 09, found while retesting:
 *   `ApiClient.saveNotes` swallows every network/HTTP error and returns `false` instead of
 *   throwing, but `flushCurrentNoteEditor` only reacts to a *throw* — so a failed save still
 *   reads "Saved", the dirty flag stays cleared, and the edit is never retried, despite the dev
 *   reply saying the flag is "retained on failure so subsequent actions retry". Playwright reports
 *   a `test.fail` test as passing while it fails and as a hard failure the moment it starts
 *   passing — so when dev fixes it, this flips loudly and should be converted to a normal test.
 *
 * Finding 06's residual (rapid Notes-tab-then-type edits being clobbered by a late GET response)
 * is deliberately NOT encoded as a test here: it's timing-dependent (~58% in a 12-run diagnostic),
 * so a test.fail would itself flake by occasionally passing. See the 2026-09-20 retest report and
 * e2e/daily-journal.spec.ts's header.
 */
test.describe('notes save behavior', () => {
  test('pure navigation (view-mode buttons, week nav) fires no notes save when notes were never touched', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    await page.waitForTimeout(600); // let initial-load traffic settle

    let notesPosts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/todos/notes')) notesPosts++;
    });

    for (const sel of [
      '.view-mode-btn[data-mode="day"]',
      '.view-mode-btn[data-mode="month"]',
      '.view-mode-btn[data-mode="week"]',
      '#nextWeekBtn',
      '#prevWeekBtn',
      '#todayBtn',
    ]) {
      await page.click(sel);
      await page.waitForTimeout(150);
    }
    expect(notesPosts).toBe(0);
  });

  test.fail('a failed notes save (server 500) is reported as "Save failed", not "Saved" (Finding 09)', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="notes"]');
    await page.route('**/api/todos/notes', (route) =>
      route.fulfill({ status: 500, body: '{"error":"boom"}' })
    );
    await page.fill('#weeklyNotesTextarea', 'Edit while the server is failing');
    await page.locator('#weeklyNotesTextarea').blur();
    await expect(page.locator('#notesSavedStatus')).toHaveText('Save failed', { timeout: 3000 });
  });
});
