import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Registers a fresh, uniquely-emailed user through the actual UI (not the API) and waits for the
 * authenticated app shell to appear. Shared by every e2e spec that needs to start "already
 * logged in" without re-testing the login flow itself (that's login-gate.spec.ts's job).
 */
export async function registerAndLoginViaUI(page: Page): Promise<{ email: string; displayName: string }> {
  const email = `qa-e2e-${randomUUID()}@dayflow-qa.test`;
  const displayName = 'QA E2E User';

  await page.goto('/');
  await page.click('#tabLandingRegister');
  await page.fill('#landingRegisterName', displayName);
  await page.fill('#landingRegisterEmail', email);
  await page.fill('#landingRegisterPassword', 'CorrectHorseBattery9');
  // Submit via Enter in the form rather than guessing the submit button's markup — a <form>'s
  // default submit behavior fires on Enter from any of its text inputs.
  await page.locator('#landingRegisterPassword').press('Enter');

  await page.waitForSelector('#app:not([style*="display: none"])');
  return { email, displayName };
}
