import type { Page } from "playwright";

const DASHBOARD_URL =
  "https://secure.chase.com/web/auth/dashboard#/dashboard/overview";
const LOGIN_URL =
  "https://secure.chase.com/web/auth/#/logon/logon/chaseOnline";

export { DASHBOARD_URL };

export async function login(
  page: Page,
  username: string,
  password: string
): Promise<boolean> {
  // Try loading the dashboard directly — if session cookies are valid
  // this skips login entirely.
  console.log("[chase] Checking for active session...");
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

  if (await isLoggedIn(page)) {
    console.log("[chase] Already logged in via saved session!");
    return true;
  }

  // Session expired or doesn't exist — go to login page
  console.log("[chase] Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

  const userIdInput = page.locator("#userId-input-field-input");
  await userIdInput.waitFor({ state: "visible", timeout: 10000 });

  console.log("[chase] Entering credentials...");
  await userIdInput.fill(username);
  await page.locator("#password-input-field-input").fill(password);

  // Check "Remember me" — SVG overlay requires force click
  try {
    await page.locator("#rememberMe").check({ force: true, timeout: 2000 });
  } catch {
    // Not critical
  }

  await page.locator("#signin-button").click();
  console.log("[chase] Submitted credentials...");
  await page.waitForTimeout(3000);

  // Check for credential errors (specific text, not generic alerts)
  const loginError = page.locator(
    'text="Please check your information",' +
      'text="enter a valid user ID",' +
      'text="enter a valid password",' +
      'text="doesn\'t match our records"'
  );
  if (await loginError.first().isVisible().catch(() => false)) {
    const msg = await loginError.first().textContent().catch(() => "");
    console.error(`[chase] Login failed: ${msg || "check your credentials."}`);
    return false;
  }

  if (await isLoggedIn(page)) {
    console.log("[chase] Login successful (no 2FA required).");
    return true;
  }

  return await handle2FA(page);
}

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  CHASE — TWO-FACTOR AUTHENTICATION");
  console.log("========================================");
  console.log("Complete the 2FA in the browser window.");
  console.log("Waiting for you to finish (up to 3 minutes)...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    // Wait for actual dashboard — exclude intercept/security gate pages
    if (url.includes("dashboard") && !url.includes("intercept")) {
      console.log("[chase] 2FA completed — dashboard detected.");
      await page.waitForTimeout(3000);
      return true;
    }
    // Handle security intercept page — user may need to interact with it
    if (url.includes("intercept")) {
      console.log("[chase] Security intercept page detected. Complete it in the browser...");
    }
  }

  console.error("[chase] Timed out waiting for 2FA completion.");
  return false;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("dashboard") || url.includes("/account")) {
    try {
      await page.waitForSelector('[data-testid="accountTile"]', {
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
