import type { Page } from "playwright";

const LOGIN_URL =
  "https://digital.fidelity.com/prgw/digital/login/full-page";
export const SUMMARY_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/summary";

export async function login(
  page: Page,
  username: string,
  password: string
): Promise<boolean> {
  console.log("[fidelity] Checking for active session...");
  await page.goto(SUMMARY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[fidelity] Already logged in via saved session!");
    return true;
  }

  console.log("[fidelity] Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(3000);

  // Fill credentials (Fidelity uses pvd-input components with specific IDs)
  const usernameInput = page.locator("#dom-username-input");
  await usernameInput.waitFor({ timeout: 10000 });
  await usernameInput.fill(username);

  const passwordInput = page.locator("#dom-pswd-input");
  await passwordInput.fill(password);

  // Submit
  await page.locator("#dom-login-button").click();
  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[fidelity] Login successful (no 2FA required).");
    return true;
  }

  return await handle2FA(page);
}

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  FIDELITY — TWO-FACTOR AUTHENTICATION");
  console.log("========================================");

  // Fidelity shows a "Send notification" button for push 2FA
  const sendBtn = page.locator("#dom-push-primary-button");
  if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Check "Don't ask me again" to trust this device
    const trustCheckbox = page.locator("#dom-trust-device-checkbox");
    if (await trustCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await trustCheckbox.check({ force: true });
    }
    console.log("Sending push notification...");
    await sendBtn.click();
  }

  console.log("Approve the login on your Fidelity Investments app.");
  console.log("Waiting up to 3 minutes...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (await isLoggedIn(page)) {
      console.log("[fidelity] 2FA completed.");
      return true;
    }
  }

  console.error("[fidelity] Timed out waiting for 2FA.");
  return false;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/login") || url.includes("/challenge")) {
    return false;
  }
  // After login, Fidelity shows the portfolio with an account selector
  if (url.includes("/portfolio/") || url.includes("/ftgw/digital/")) {
    try {
      // The account selector balance is a reliable post-login indicator
      await page.waitForSelector(".acct-selector__all-accounts-balance", {
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
