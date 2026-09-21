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

  // Finding 21 — /auth/login, /auth/register and /auth/google never return `hasPassword` (only
  // /auth/me does), and the UI stores whatever the login response contained, so the Settings
  // card's "no password yet → hide current-password field / show 'Set Account Password'" branch
  // (`u.hasPassword === false`) can never be reached. Verified here through what the browser stores.
  test.fail('the login response the UI stores includes hasPassword, so the Settings card can adapt (Finding 21)', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}'));
    expect(stored).toHaveProperty('hasPassword');
  });
});
