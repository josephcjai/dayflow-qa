import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.describe('login gate', () => {
  test('an unauthenticated visitor sees the login screen, not the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loginScreen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
  });

  test('registering with a fresh email lands on the authenticated grid', async ({ page }) => {
    const email = `qa-e2e-${randomUUID()}@dayflow-qa.test`;

    await page.goto('/');
    await page.click('#tabLandingRegister');
    await page.fill('#landingRegisterName', 'Gate Test User');
    await page.fill('#landingRegisterEmail', email);
    await page.fill('#landingRegisterPassword', 'CorrectHorseBattery9');
    await page.locator('#landingRegisterPassword').press('Enter');

    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#loginScreen')).toBeHidden();
    await expect(page.locator('#userDisplayName')).toHaveText('Gate Test User');
  });

  test('logging in with the wrong password stays on the login screen with an error, never enters the app', async ({
    page,
  }) => {
    // Uses REGRESSION checklist #1's product surface: even though the *behavior* is covered at
    // the API layer (api/01-auth.spec.ts), this confirms the UI actually surfaces the rejection
    // instead of, say, silently retrying or rendering the app shell on a failed request.
    await page.goto('/');
    await page.fill('#landingLoginEmail', 'nobody-at-all@dayflow-qa.test');
    await page.fill('#landingLoginPassword', 'WrongPassword9');
    await page.locator('#landingLoginPassword').press('Enter');

    await expect(page.locator('#landingLoginErrorMsg')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
  });

  test('the Google sign-in option appears on the login screen when the server reports it configured', async ({
    page,
  }) => {
    // Added 2026-09-09 for the new Google Sign-In feature (commit d922a30). Confirmed against
    // src/js/app.js: the section is unconditionally shown as soon as /auth/config returns a
    // non-empty googleClientId and Google's own script has loaded — that part doesn't depend on
    // the client ID actually being valid, so this is safe to check even with the fake QA value
    // (see docker-compose.test.yml). What this deliberately does NOT do: click the button or
    // attempt an actual sign-in — that needs a real Google account and consent flow, which no
    // automated test can provide. See api/11-google-auth.spec.ts's header for the full reasoning.
    await page.goto('/');
    await expect(page.locator('#googleAuthSection')).toBeVisible();
    await expect(page.locator('#googleSignInBtn')).toBeVisible();
  });

  test('logout returns to the login screen', async ({ page }) => {
    const email = `qa-e2e-${randomUUID()}@dayflow-qa.test`;
    await page.goto('/');
    await page.click('#tabLandingRegister');
    await page.fill('#landingRegisterName', 'Logout Test User');
    await page.fill('#landingRegisterEmail', email);
    await page.fill('#landingRegisterPassword', 'CorrectHorseBattery9');
    await page.locator('#landingRegisterPassword').press('Enter');
    await expect(page.locator('#app')).toBeVisible();

    await page.click('#logoutBtn');

    await expect(page.locator('#loginScreen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
  });
});
