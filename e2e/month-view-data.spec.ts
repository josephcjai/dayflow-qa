import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-17 for a real bug fix bundled into commit 5330565 ("feat(notes): add
 * date-specific Daily Journal and unify ES module versioning"): src/js/grid.js's
 * `renderMonthGrid` used to read every day cell's task count from whichever ONE week happened to
 * already be loaded into `weekData` — so a Month view's day cells for any week other than the
 * currently-loaded one always showed "No tasks", regardless of what was actually scheduled there.
 * Fixed by looking each day up in its own week's data (`STATE.scheduleData[getWeekKey(dObj)]`),
 * which depends on state.js's companion change to prefetch every week touching the visible month
 * (`syncWeekDataWithApi`'s new month-mode branch).
 *
 * This test creates tasks in two different weeks within the same calendar month and confirms
 * Month view shows both correctly — the actual regression the fix addresses — not just "Month
 * view is active" (already covered by e2e/view-modes.spec.ts and view-mode-persistence.spec.ts).
 *
 * Both target dates are computed relative to "today" (never a fixed literal date, so this doesn't
 * rot), 2 calendar months out to stay clear of any real-world edge case, and 14 days apart so they
 * always land in different weeks regardless of what weekday "today" is.
 */

// Local date components, NOT `.toISOString()` — confirmed live (this machine runs IST, UTC+5:30)
// that converting a local-midnight-constructed Date to UTC rolls it back to the PREVIOUS calendar
// day whenever the local offset is positive, silently sending the date picker to the wrong day
// while dayName() (below) still reports the originally-intended day's name. Any positive-UTC-offset
// timezone hits this; the fix is to never round-trip through UTC when the value has to stay a
// specific LOCAL calendar date.
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayName(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

async function createTaskOn(page: import('@playwright/test').Page, targetDate: Date, taskText: string) {
  await page.fill('#weekDatePicker', isoDate(targetDate));
  await page
    .locator(`td.slot-cell[data-time-label="08:00 AM"][data-day-name="${dayName(targetDate)}"]`)
    .dblclick();
  await page.fill('#plannedTaskInput', taskText);
  await page.fill('#actualTaskInput', taskText);
  await page.getByRole('button', { name: 'Save Slot Task' }).click();
  await expect(page.locator('#taskModal')).not.toHaveClass(/active/);
}

test.describe('Month view — cross-week data correctness', () => {
  test('day cells from a week other than the one initially loaded still show their real task counts', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);

    // A safely future month (2 months out) so target dates never land on an already-past,
    // time-locked slot (see e2e/time-lock.spec.ts) and never straddle the current real-world month.
    const base = new Date();
    base.setMonth(base.getMonth() + 2, 1); // day 1 of that month, no day-count overflow risk
    const dayA = new Date(base.getFullYear(), base.getMonth(), 5);
    const dayB = new Date(base.getFullYear(), base.getMonth(), 19); // 14 days later — a different week

    await createTaskOn(page, dayA, 'Month Grid Task A');
    await createTaskOn(page, dayB, 'Month Grid Task B');

    // Land Month view on the same month as both dates.
    await page.fill('#weekDatePicker', isoDate(dayA));
    await page.click('.view-mode-btn[data-mode="month"]');
    await expect(page.locator('#monthViewContainer')).toBeVisible();

    const cellA = page.locator(`.month-day-cell[data-date="${isoDate(dayA)}"]`);
    const cellB = page.locator(`.month-day-cell[data-date="${isoDate(dayB)}"]`);
    await expect(cellA.locator('.month-metric-badge').first()).toBeVisible();
    await expect(cellA.locator('.month-empty-text')).toHaveCount(0);
    // This is the one that would have failed before the fix — dayB's week isn't the one that was
    // loaded when dayA's slot was created, so its data would have come from the wrong week.
    await expect(cellB.locator('.month-metric-badge').first()).toBeVisible();
    await expect(cellB.locator('.month-empty-text')).toHaveCount(0);
  });
});
