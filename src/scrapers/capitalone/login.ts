import type { Page } from "playwright";

const LOGIN_URL = "https://myaccounts.capitalone.com/signIn";
export const DASHBOARD_URL =
  "https://myaccounts.capitalone.com/accountSummary";

export async function login(
  page: Page,
  username: string,
  password: string
): Promise<boolean> {
  // Try loading the dashboard directly — if session cookies are valid
  // this skips login entirely.
  console.log("[capitalone] Checking for active session...");
  await page.goto(DASHBOARD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[capitalone] Already logged in via saved session!");
    return true;
  }

  // Session expired or doesn't exist — go to login page
  // The login page redirects to verified.capitalone.com
  console.log("[capitalone] Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(3000);

  // Capital One login form selectors (confirmed from debug output)
  // Form is on the main frame at verified.capitalone.com (redirected from signIn)
  const userField = page.locator("#usernameInputField");
  await userField.waitFor({ state: "visible", timeout: 10000 });

  console.log("[capitalone] Entering credentials...");
  await userField.fill(username);

  const passField = page.locator("#pwInputField");
  await passField.waitFor({ state: "visible", timeout: 5000 });
  await passField.fill(password);

  // Check "Remember Me" if available
  try {
    const rememberMe = page.locator("#omni-checkbox-1");
    if (await rememberMe.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rememberMe.check({ force: true });
    }
  } catch {
    // Not critical
  }

  // Click "Sign in" button
  await page.locator('button[type="submit"]').click();
  console.log("[capitalone] Submitted credentials...");
  await page.waitForTimeout(5000);

  // Check for credential errors
  const loginError = page.locator(
    'text="incorrect username or password",' +
      'text="enter a valid username",' +
      'text="enter your password",' +
      'text="we couldn\'t verify your identity"'
  );
  if (await loginError.first().isVisible().catch(() => false)) {
    const msg = await loginError.first().textContent().catch(() => "");
    console.error(
      `[capitalone] Login failed: ${msg || "check your credentials."}`
    );
    return false;
  }

  if (await isLoggedIn(page)) {
    console.log("[capitalone] Login successful (no 2FA required).");
    return true;
  }

  return await handle2FA(page);
}

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  CAPITAL ONE — TWO-STEP VERIFICATION");
  console.log("========================================");
  console.log("Complete the verification in the browser window.");
  console.log("Enter the code sent via SMS/email, or approve the push notification.");
  console.log("Waiting for you to finish (up to 3 minutes)...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (await isLoggedIn(page)) {
      console.log("[capitalone] 2FA completed — dashboard detected.");
      return true;
    }
  }

  console.error("[capitalone] Timed out waiting for 2FA completion.");
  return false;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // After login, Capital One redirects to myaccounts.capitalone.com
  if (
    !url.includes("myaccounts.capitalone.com") ||
    url.includes("signIn") ||
    url.includes("sign-in")
  ) {
    return false;
  }

  try {
    // Look for the Account Summary page title or account tiles
    await page.waitForSelector(
      'h1.accessibility-page-title, div.account-tile, img[role="heading"]',
      { timeout: 8000 }
    );
    return true;
  } catch {
    // Fallback: check for dollar amounts on the page
    if (url.includes("/accountSummary") || url.includes("/account/")) {
      await page.waitForTimeout(2000);
      const hasBalance = await page
        .locator('text=/\\$[\\d,]+\\.\\d{2}/')
        .first()
        .isVisible()
        .catch(() => false);
      return hasBalance;
    }
    return false;
  }
}
