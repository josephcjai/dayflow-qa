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
 * UPDATE 2026-09-20 (commit 63498c7): Finding 09 is FIXED, so its test above is now a normal test.
 * The third test is a new expected-failure marker (test.fail) for Finding 10, a regression the fixes
 * introduced: the dirty flag is global and stays set until the save RESPONSE arrives / forever after
 * a failure, and both syncWeekDataWithApi and renderNotes skip updating while it is set — so after a
 * failed save on day A, navigating to day B leaves A's text in B's editor, later saved onto B.
 *
 * UPDATE 2026-09-20 (v2.4.0 / 91a595c): Findings 10 and 11 are FIXED (context-scoped rendering);
 * the Finding 10 test above is now a normal test. The last test is a new expected-failure marker
 * for Finding 12: the failed-save retry marker is cleared by ANY successful save (including a
 * different week's), so a note whose save failed while the user left that week is never re-sent
 * once connectivity returns, while the status pill reads "Saved".
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

  test('a failed notes save (server 500) is reported as "Save failed", not "Saved" (Finding 09, fixed in 63498c7)', async ({
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

  test('after a failed save on one day, the next day editor does not inherit that text (Finding 10, fixed in v2.4.0)', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayA = new Date();
    dayA.setDate(dayA.getDate() + 8);
    const dayB = new Date();
    dayB.setDate(dayB.getDate() + 15);

    await page.fill('#weekDatePicker', iso(dayA));
    await page.click('.view-mode-btn[data-mode="day"]');
    await page.click('.nav-btn[data-view="notes"]');
    await page.waitForTimeout(1000); // let the setup sync settle (see e2e/daily-journal.spec.ts)

    await page.route('**/api/todos/notes', (route) => route.fulfill({ status: 500, body: '{"error":"boom"}' }));
    await page.fill('#weeklyNotesTextarea', 'ONLY FOR DAY A');
    await page.locator('#weeklyNotesTextarea').blur();
    await page.waitForTimeout(500);

    await page.fill('#weekDatePicker', iso(dayB));
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('', { timeout: 3000 });
  });

  test.fail('a note whose save failed is re-sent after the user left that day and the server recovered (Finding 12)', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayA = new Date();
    dayA.setDate(dayA.getDate() + 8);
    const dayB = new Date();
    dayB.setDate(dayB.getDate() + 15);

    await page.fill('#weekDatePicker', iso(dayA));
    await page.click('.view-mode-btn[data-mode="day"]');
    await page.click('.nav-btn[data-view="notes"]');
    await page.waitForTimeout(1000);

    await page.route('**/api/todos/notes', (route) => route.fulfill({ status: 500, body: '{"error":"boom"}' }));
    await page.fill('#weeklyNotesTextarea', 'ONLY FOR DAY A');
    await page.locator('#weeklyNotesTextarea').blur();
    await page.waitForTimeout(600);

    await page.fill('#weekDatePicker', iso(dayB)); // leave day A while the server is failing
    await page.waitForTimeout(600);
    await page.unroute('**/api/todos/notes'); // server recovers
    await page.fill('#weekDatePicker', iso(dayB)); // no-op re-pick; then navigate again
    await page.click('#nextWeekBtn');
    await page.waitForTimeout(1000);
    await page.fill('#weekDatePicker', iso(dayA));
    await page.waitForTimeout(800);

    await page.reload();
    await page.fill('#weekDatePicker', iso(dayA));
    await page.click('.view-mode-btn[data-mode="day"]');
    await page.click('.nav-btn[data-view="notes"]');
    await expect(page.locator('#weeklyNotesTextarea')).toHaveValue('ONLY FOR DAY A', { timeout: 3000 });
  });
});
