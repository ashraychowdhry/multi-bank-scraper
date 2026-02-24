import type { Page } from "playwright";

const LOGIN_URL =
  "https://www.americanexpress.com/en-us/account/login/";
export const DASHBOARD_URL =
  "https://global.americanexpress.com/dashboard";

export async function login(
  page: Page,
  username: string,
  password: string
): Promise<boolean> {
  // Try loading the dashboard directly — if session cookies are valid
  // this skips login entirely.
  console.log("[amex] Checking for active session...");
  await page.goto(DASHBOARD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[amex] Already logged in via saved session!");
    return true;
  }

  // Session expired or doesn't exist — go to login page
  console.log("[amex] Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(3000);

  // Login form is on the main page (not in an iframe)
  // Confirmed selectors: #eliloUserID (data-testid="userid-input")
  //                       #eliloPassword (data-testid="password-input")
  const userField = page.locator('#eliloUserID');
  await userField.waitFor({ state: "visible", timeout: 10000 });

  console.log("[amex] Entering credentials...");
  await userField.fill(username);

  const passField = page.locator('#eliloPassword');
  await passField.waitFor({ state: "visible", timeout: 5000 });
  await passField.fill(password);

  // Check "Remember me" if available
  try {
    const rememberMe = page.locator('#rememberMe');
    if (await rememberMe.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rememberMe.check({ force: true });
    }
  } catch {
    // Not critical
  }

  // Click "Log In" button
  await page.locator('#loginSubmit').click();
  console.log("[amex] Submitted credentials...");
  await page.waitForTimeout(5000);

  // Check for credential errors
  const loginError = page.locator(
    'text="User ID or Password is not correct",' +
      'text="enter a valid User ID",' +
      'text="enter your Password",' +
      'text="we couldn\'t verify your identity"'
  );
  if (await loginError.first().isVisible().catch(() => false)) {
    const msg = await loginError.first().textContent().catch(() => "");
    console.error(`[amex] Login failed: ${msg || "check your credentials."}`);
    return false;
  }

  if (await isLoggedIn(page)) {
    console.log("[amex] Login successful (no 2FA required).");
    return true;
  }

  return await handle2FA(page);
}

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  AMEX — TWO-STEP VERIFICATION");
  console.log("========================================");
  console.log("Complete the verification in the browser window.");
  console.log("Enter the code sent to your phone/email.");
  console.log("Waiting for you to finish (up to 3 minutes)...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (await isLoggedIn(page)) {
      console.log("[amex] 2FA completed — dashboard detected.");
      return true;
    }
  }

  console.error("[amex] Timed out waiting for 2FA completion.");
  return false;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // After login, Amex redirects to global.americanexpress.com
  if (
    url.includes("global.americanexpress.com") &&
    !url.includes("login") &&
    !url.includes("challenge") &&
    !url.includes("verification")
  ) {
    try {
      // Look for card switcher — present on all authenticated pages
      await page.waitForSelector(
        '[data-testid="simple_switcher_display_name"], [data-testid="simple_switcher_wrapper"], [data-testid="page_content_wrapper"]',
        { timeout: 8000 }
      );
      return true;
    } catch {
      // Fallback: check if we're on a known authenticated page
      if (
        url.includes("/dashboard") ||
        url.includes("/activity") ||
        url.includes("/offers")
      ) {
        await page.waitForTimeout(2000);
        const hasContent = await page
          .locator('[data-testid="simple_switcher_display_name"]')
          .first()
          .isVisible()
          .catch(() => false);
        return hasContent;
      }
      return false;
    }
  }
  return false;
}
