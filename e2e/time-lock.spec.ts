import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Checklist item #9 — the one genuinely DOM-only item. Confirmed against
 * server/src/routes/scheduleRoutes.ts in the pinned checkout: POST /schedule/slot accepts
 * plannedTask unconditionally regardless of time, so this rule is enforced ONLY in the frontend
 * modal (#plannedLockMsg / disabling #plannedTaskInput) — it cannot be asserted from api/.
 */

// A full week+ away in each direction, not just ±1 day: confirmed live that "tomorrow" is fragile
// whenever today happens to fall on a Monday (the week's own start) — "tomorrow" then lands in
// the SAME week as today, whose Monday column is today itself, already partly in the past by the
// time the test runs. ±8 days always lands in an unambiguous, entirely past/future week regardless
// of what day of the week "today" is.
function daysFromNow(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayName(d: Date): string {
  // Matches the full weekday name the app renders as the modal's day badge (confirmed against a
  // live screenshot — "Monday", "Tuesday", etc.) and, per grid.js, sets as td[data-day-name].
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

async function openSlotModal(page: import('@playwright/test').Page, targetDate: Date, timeLabel: string) {
  await page.fill('#weekDatePicker', isoDate(targetDate));
  // Confirmed live: picking td.slot-cell by time-label alone (no day filter) always grabbed
  // Monday's column regardless of the target date, since Monday is first in DOM order — that
  // silently passed both "past" and "future" cases before real dates ever put a Monday in the
  // wrong bucket. Filtering by data-day-name too is what actually pins down the intended day.
  // dblclick, not click — confirmed against grid.js (commit d922a30, 2026-09-09): a single click
  // on a cell now only *selects* it (first click) or opens the modal if already selected (second
  // click), for the new copy/paste/multi-select cell interactions. dblclick's own handler always
  // opens the modal directly regardless of selection state.
  await page
    .locator(`td.slot-cell[data-time-label="${timeLabel}"][data-day-name="${dayName(targetDate)}"]`)
    .dblclick();
}

test.describe('Planned Task time-lock', () => {
  test('a slot from a past day: Planned Task is locked, Actual Task remains editable', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await openSlotModal(page, daysFromNow(-8), '08:00 AM');

    await expect(page.locator('#plannedLockMsg')).toBeVisible();
    await expect(page.locator('#plannedTaskInput')).toBeDisabled();
    await expect(page.locator('#actualTaskInput')).toBeEnabled();
    await expect(page.locator('#taskStatusSelect')).toBeEnabled();
  });

  test('a slot from a future day: Planned Task is fully editable, no lock message', async ({ page }) => {
    await registerAndLoginViaUI(page);
    await openSlotModal(page, daysFromNow(8), '08:00 AM');

    await expect(page.locator('#plannedLockMsg')).toBeHidden();
    await expect(page.locator('#plannedTaskInput')).toBeEnabled();
    await expect(page.locator('#actualTaskInput')).toBeEnabled();
  });

  // The exact instant a slot transitions from "not yet passed" to "passed" is inherently
  // timing-sensitive to automate without controlling the browser's clock (Playwright's
  // page.clock API — not wired up here to keep this scaffold dependency-light). Treat the literal
  // boundary second as a manual/exploratory check per onboarding item #9's "test at the boundary"
  // instruction; this suite covers the two unambiguous sides of it.
});
