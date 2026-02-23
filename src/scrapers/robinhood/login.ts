import type { Page } from "playwright";

const LOGIN_URL = "https://robinhood.com/login/";

export async function login(
  page: Page,
  username: string,
  password: string
): Promise<boolean> {
  console.log("[robinhood] Checking for active session...");
  await page.goto("https://robinhood.com/", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  if (await isLoggedIn(page)) {
    console.log("[robinhood] Already logged in via saved session!");
    return true;
  }

  console.log("[robinhood] Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  // Fill email
  const emailInput = page.locator('input[name="username"]');
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(username);

  // Fill password
  const passwordInput = page.locator("input#current-password");
  await passwordInput.fill(password);

  // Click "Log In" submit button
  const signInButton = page.locator('button[type="submit"]');
  await signInButton.click();
  await page.waitForTimeout(3000);

  if (await isLoggedIn(page)) {
    console.log("[robinhood] Login successful (no 2FA).");
    return true;
  }

  return await handle2FA(page);
}

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  ROBINHOOD — DEVICE APPROVAL");
  console.log("========================================");
  console.log("Approve the login on your Robinhood app.");
  console.log("Waiting up to 3 minutes...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (await isLoggedIn(page)) {
      console.log("[robinhood] 2FA completed.");
      return true;
    }
  }

  console.error("[robinhood] Timed out waiting for 2FA.");
  return false;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // After login, Robinhood redirects to https://robinhood.com/?classic=1 or /
  if (!url.includes("/login") && !url.includes("/challenge")) {
    try {
      await page.waitForSelector('[data-testid="PortfolioValue"]', {
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
