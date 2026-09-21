import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { registerAndLoginViaUI } from './fixtures.js';
import { waitForResetLink } from '../shared/mailbox.js';

/**
 * Added 2026-09-21 for commit 8fbc404: the "Forgot Password?" and reset-password screens on the
 * login page. The emailed link is read back from the API container's log (see shared/mailbox.ts —
 * QA has no mail server) and opened as a real URL, so this exercises the same hash-route
 * (`#reset-password?token=…&email=…`) a user's email client would open.
 *
 * Batched in test:e2e:batch3 (see package.json) to stay inside the shared auth rate-limit budget.
 */
const OLD_PW = 'CorrectHorseBattery9';
const NEW_PW = 'BrandNewPassw0rd!';

async function logoutAndOpenLogin(page: Page) {
  await page.click('#logoutBtn');
  await expect(page.locator('#loginScreen')).toBeVisible();
}

async function signInViaUI(page: Page, email: string, password: string) {
  await page.fill('#landingLoginEmail', email);
  await page.fill('#landingLoginPassword', password);
  await page.locator('#landingLoginPassword').press('Enter');
}

test.describe('forgot / reset password (login screen)', () => {
  test('"Forgot Password?" opens the request form, and "Back to Sign In" returns to the login form', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#landingLoginForm')).toBeVisible();

    await page.click('#landingForgotPasswordLink');
    await expect(page.locator('#landingForgotPasswordForm')).toBeVisible();
    await expect(page.locator('#landingLoginForm')).toBeHidden();
    await expect(page.locator('#authTabs')).toBeHidden(); // sign-in/register tabs are hidden on this screen

    await page.click('#landingForgotBackToSignIn');
    await expect(page.locator('#landingLoginForm')).toBeVisible();
    await expect(page.locator('#landingForgotPasswordForm')).toBeHidden();
    await expect(page.locator('#authTabs')).toBeVisible();
  });

  test('requesting a reset shows the SAME confirmation for an existing and an unknown email', async ({ page }) => {
    await registerAndLoginViaUI(page);
    const knownEmail = (await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}').email)) as string;
    await logoutAndOpenLogin(page);

    const messages: string[] = [];
    for (const email of [knownEmail, `nobody-${randomUUID()}@dayflow-qa.test`]) {
      await page.click('#landingForgotPasswordLink');
      await page.fill('#landingForgotEmail', email);
      await page.click('#landingForgotSubmitBtn');
      await expect(page.locator('#landingForgotStatusMsg')).toBeVisible();
      await expect(page.locator('#landingForgotSubmitBtn')).toBeEnabled(); // button recovers after the request
      messages.push((await page.locator('#landingForgotStatusMsg').textContent()) ?? '');
      await page.click('#landingForgotBackToSignIn');
    }
    expect(messages[0]).toMatch(/if an account exists/i);
    expect(messages[1]).toBe(messages[0]); // no enumeration through the UI either
  });

  test('the emailed link opens the reset form; mismatched passwords and a wrong token are rejected with a visible error', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    const email = (await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}').email)) as string;
    await logoutAndOpenLogin(page);
    await page.click('#landingForgotPasswordLink');
    await page.fill('#landingForgotEmail', email);
    await page.click('#landingForgotSubmitBtn');
    const link = await waitForResetLink(email);

    // open the link exactly as an email client would: a fresh navigation to the emailed hash route
    await page.goto(`/#reset-password?token=${link.token}&email=${encodeURIComponent(email)}`);
    await expect(page.locator('#landingResetPasswordForm')).toBeVisible();
    await expect(page.locator('#landingLoginForm')).toBeHidden();

    await page.fill('#landingResetNewPassword', NEW_PW);
    await page.fill('#landingResetConfirmPassword', 'a-different-password');
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toContainText(/do not match/i);

    // a wrong token: server rejects, UI shows the server's message and the form stays usable
    await page.goto(`/#reset-password?token=${'f'.repeat(64)}&email=${encodeURIComponent(email)}`);
    await page.fill('#landingResetNewPassword', NEW_PW);
    await page.fill('#landingResetConfirmPassword', NEW_PW);
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toContainText(/invalid or has already been used/i);
    await expect(page.locator('#landingResetSubmitBtn')).toBeEnabled();
  });

  test('a full reset through the UI: new password signs in, old password is refused, link cannot be reused', async ({
    page,
  }) => {
    await registerAndLoginViaUI(page);
    const email = (await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}').email)) as string;
    await logoutAndOpenLogin(page);
    await page.click('#landingForgotPasswordLink');
    await page.fill('#landingForgotEmail', email);
    await page.click('#landingForgotSubmitBtn');
    const link = await waitForResetLink(email);
    const resetUrl = `/#reset-password?token=${link.token}&email=${encodeURIComponent(email)}`;

    await page.goto(resetUrl);
    await page.fill('#landingResetNewPassword', NEW_PW);
    await page.fill('#landingResetConfirmPassword', NEW_PW);
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toContainText(/reset successfully/i);
    await expect(page.locator('#landingResetSubmitBtn')).toBeHidden(); // can't double-submit

    // the app returns to Sign In with the email pre-filled
    await expect(page.locator('#landingLoginForm')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('#landingLoginEmail')).toHaveValue(email);

    await signInViaUI(page, email, OLD_PW);
    await expect(page.locator('#landingLoginErrorMsg')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    await signInViaUI(page, email, NEW_PW);
    await expect(page.locator('#app')).toBeVisible();

    // replaying the same link is refused
    await page.evaluate(() => localStorage.clear());
    await page.goto(resetUrl);
    await page.reload();
    await page.fill('#landingResetNewPassword', 'YetAnotherPassw0rd!');
    await page.fill('#landingResetConfirmPassword', 'YetAnotherPassw0rd!');
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toContainText(/invalid or has already been used/i);
  });

  test('hostile values in the reset link are inert: no script runs and no markup is injected', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    const evil = encodeURIComponent('"><img src=x onerror=alert(1)>@x.test');
    await page.goto(`/#reset-password?token=${encodeURIComponent('<script>alert(2)</script>')}&email=${evil}`);
    await expect(page.locator('#landingResetPasswordForm')).toBeVisible();
    await page.fill('#landingResetNewPassword', NEW_PW);
    await page.fill('#landingResetConfirmPassword', NEW_PW);
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toBeVisible();
    await page.waitForTimeout(500);
    expect(dialogs).toBe(0);
    await expect(page.locator('#loginScreen img[src="x"]')).toHaveCount(0);
  });

  // Finding 22 (fixed in 0563993) — the one-time token used to stay in the address bar / history
  test('after a successful reset the one-time token is no longer in the page URL (Finding 22)', async ({ page }) => {
    await registerAndLoginViaUI(page);
    const email = (await page.evaluate(() => JSON.parse(localStorage.getItem('dayflow_user') || '{}').email)) as string;
    await logoutAndOpenLogin(page);
    await page.click('#landingForgotPasswordLink');
    await page.fill('#landingForgotEmail', email);
    await page.click('#landingForgotSubmitBtn');
    const link = await waitForResetLink(email);
    await page.goto(`/#reset-password?token=${link.token}&email=${encodeURIComponent(email)}`);
    await page.fill('#landingResetNewPassword', NEW_PW);
    await page.fill('#landingResetConfirmPassword', NEW_PW);
    await page.click('#landingResetSubmitBtn');
    await expect(page.locator('#landingResetStatusMsg')).toContainText(/reset successfully/i);
    await page.waitForTimeout(2600); // the app switches back to Sign In after ~2.2s
    expect(page.url()).not.toContain(link.token);
    expect(page.url()).not.toContain('reset-password');
  });
});
