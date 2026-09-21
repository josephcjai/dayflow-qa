import { test, expect } from '@playwright/test';
import { registerAndLoginViaUI } from './fixtures.js';

/**
 * Added 2026-09-21 for commit 8fbc404: Settings → "Account & Security" change-password card.
 * Batched in test:e2e:batch3 (see package.json). API-level behaviour (wrong current password,
 * validation, single-user isolation) is in api/15-password-management.spec.ts; this file only
 * covers what needs the real form.
 */
const OLD_PW = 'CorrectHorseBattery9';
const NEW_PW = 'BrandNewPassw0rd!';

test.describe('Settings — change password', () => {
  test('the Account & Security card is present for a password account, with the current-password field shown', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="settings"]');
    await expect(page.locator('#settingsAccountCard')).toBeVisible();
    await expect(page.locator('#settingsCurrentPasswordGroup')).toBeVisible();
    await expect(page.locator('#settingsSavePasswordBtn')).toContainText(/update password/i);
  });

  test('mismatched confirmation and a wrong current password are rejected with a visible error; password is unchanged', async ({
    page,
  }) => {
    const { email } = await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="settings"]');

    await page.fill('#settingsCurrentPassword', OLD_PW);
    await page.fill('#settingsNewPassword', NEW_PW);
    await page.fill('#settingsConfirmPassword', 'something-else-entirely');
    await page.click('#settingsSavePasswordBtn');
    await expect(page.locator('#settingsPasswordStatusMsg')).toContainText(/do not match/i);

    await page.fill('#settingsCurrentPassword', 'definitely-wrong');
    await page.fill('#settingsNewPassword', NEW_PW);
    await page.fill('#settingsConfirmPassword', NEW_PW);
    await page.click('#settingsSavePasswordBtn');
    await expect(page.locator('#settingsPasswordStatusMsg')).toContainText(/current password is incorrect/i);

    // still the old password
    await page.click('#logoutBtn');
    await page.fill('#landingLoginEmail', email);
    await page.fill('#landingLoginPassword', OLD_PW);
    await page.locator('#landingLoginPassword').press('Enter');
    await expect(page.locator('#app')).toBeVisible();
  });

  test('a successful change clears the form, and only the new password signs in afterwards', async ({ page }) => {
    const { email } = await registerAndLoginViaUI(page);
    await page.click('.nav-btn[data-view="settings"]');

    await page.fill('#settingsCurrentPassword', OLD_PW);
    await page.fill('#settingsNewPassword', NEW_PW);
    await page.fill('#settingsConfirmPassword', NEW_PW);
    await page.click('#settingsSavePasswordBtn');
    await expect(page.locator('#settingsPasswordStatusMsg')).toContainText(/updated successfully/i);
    await expect(page.locator('#settingsNewPassword')).toHaveValue(''); // form.reset()
    await expect(page.locator('#settingsCurrentPassword')).toHaveValue('');

    await page.click('#logoutBtn');
    await page.fill('#landingLoginEmail', email);
    await page.fill('#landingLoginPassword', OLD_PW);
    await page.locator('#landingLoginPassword').press('Enter');
    await expect(page.locator('#landingLoginErrorMsg')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    await page.fill('#landingLoginPassword', NEW_PW);
    await page.locator('#landingLoginPassword').press('Enter');
    await expect(page.locator('#app')).toBeVisible();
  });

  // Finding 21 (fixed in 0563993) — login/register/google responses now carry hasPassword, so the
  // Settings card can adapt (the "set first password" branch for Google-only accounts is reachable).
  test('the login response the UI stores includes hasPassword (Finding 21)', async ({ page }) => {
    await registerAndLoginViaUI(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}'));
    expect(stored.hasPassword).toBe(true);
  });

  // Finding 15 (fixed in 0563993) — password change revokes other sessions; this tab gets a fresh token.
  test('after changing the password this tab stays signed in (fresh token stored), while ANOTHER signed-in session is signed out', async ({
    page,
    browser,
  }) => {
    const { email } = await registerAndLoginViaUI(page);

    // a second, independent session for the same account
    const other = await (await browser.newContext()).newPage();
    await other.goto('/');
    await other.fill('#landingLoginEmail', email);
    await other.fill('#landingLoginPassword', OLD_PW);
    await other.locator('#landingLoginPassword').press('Enter');
    await expect(other.locator('#app')).toBeVisible();

    const tokenBefore = await page.evaluate(() => localStorage.getItem('dayflow_token'));
    await page.click('.nav-btn[data-view="settings"]');
    await page.fill('#settingsCurrentPassword', OLD_PW);
    await page.fill('#settingsNewPassword', NEW_PW);
    await page.fill('#settingsConfirmPassword', NEW_PW);
    await page.click('#settingsSavePasswordBtn');
    await expect(page.locator('#settingsPasswordStatusMsg')).toContainText(/updated successfully/i);

    const tokenAfter = await page.evaluate(() => localStorage.getItem('dayflow_token'));
    expect(tokenAfter).not.toBe(tokenBefore); // the fresh session token was stored

    // this session keeps working across a reload
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();

    // the other session is refused on its next load and lands on the login screen
    await other.reload();
    await expect(other.locator('#loginScreen')).toBeVisible();
    await expect(other.locator('#app')).toBeHidden();
    await other.context().close();
  });
});
