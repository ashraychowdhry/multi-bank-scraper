import { chromium } from "playwright";
import * as fs from "node:fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function safeWriteJSON(path: string, data: unknown) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`  Failed to write ${path}:`, err);
  }
}

async function dumpElements(page: { $$eval: import("playwright").Page["$$eval"] }, selector: string, label: string) {
  try {
    const els = await page.$$eval(selector, (nodes) =>
      nodes.map((el) => ({
        tag: el.tagName,
        id: el.id || undefined,
        name: el.getAttribute("name") || undefined,
        type: el.getAttribute("type") || undefined,
        testid: el.getAttribute("data-testid") || undefined,
        role: el.getAttribute("role") || undefined,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
        for: el.getAttribute("for") || undefined,
        href: el.getAttribute("href")?.slice(0, 120) || undefined,
        alt: el.getAttribute("alt") || undefined,
        classes: (typeof el.className === "string" ? el.className : "").slice(0, 150) || undefined,
        text: el.textContent?.trim().slice(0, 250) || undefined,
      }))
    );
    console.log(`  [${label}] ${els.length} element(s)`);
    return els;
  } catch (err) {
    console.warn(`  [${label}] $$eval failed:`, err);
    return [];
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const authPath = ".auth/amex-state.json";
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
  };

  if (fs.existsSync(authPath)) {
    console.log(`Loading saved session from ${authPath}...`);
    contextOptions.storageState = authPath;
  }

  const context = await browser.newContext(contextOptions);

  // Protect eval from being monkeypatched by Amex's app.js
  await context.addInitScript(() => {
    const nativeEval = window.eval;
    Object.defineProperty(window, "eval", {
      value: nativeEval,
      writable: false,
      configurable: false,
    });
  });

  const page = await context.newPage();

  if (!fs.existsSync("output")) fs.mkdirSync("output", { recursive: true });

  // ──────────── 1. LOGIN PAGE ────────────
  console.log("\n=== LOGIN PAGE ===");
  await page.goto("https://www.americanexpress.com/en-us/account/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "output/amex-login.png", fullPage: true });

  // Main frame elements
  const loginEls = await dumpElements(
    page,
    "input, button, label, form, select, iframe, [data-testid]",
    "login-main"
  );
  safeWriteJSON("output/amex-login-elements.json", loginEls);

  // Check for iframes — the Amex login form is likely inside an iframe
  const iframes = page.frames();
  console.log(`  Found ${iframes.length} frame(s): ${iframes.map((f) => f.url()).join(", ")}`);
  for (let i = 0; i < iframes.length; i++) {
    const frame = iframes[i];
    if (frame === page.mainFrame()) continue;
    const frameEls = await dumpElements(
      frame,
      "input, button, label, form, select, [data-testid], [id]",
      `login-iframe-${i}`
    );
    safeWriteJSON(`output/amex-login-iframe-${i}-elements.json`, frameEls);
  }

  // ──────────── 2. AUTO-LOGIN ────────────
  console.log("\n=== AUTO-LOGIN ===");
  const dotenv = await import("dotenv");
  dotenv.config();
  const amexUser = process.env.AMEX_USERNAME || "";
  const amexPass = process.env.AMEX_PASSWORD || "";

  if (amexUser && amexPass) {
    console.log("  Filling credentials...");
    await page.locator("#eliloUserID").fill(amexUser);
    await page.locator("#eliloPassword").fill(amexPass);
    try {
      await page.locator("#rememberMe").check({ force: true, timeout: 2000 });
    } catch { /* not critical */ }
    await page.locator("#loginSubmit").click();
    console.log("  Submitted. Waiting for redirect (2FA may be required)...");
  } else {
    console.log("  No AMEX_USERNAME/AMEX_PASSWORD in .env — waiting for manual login...");
  }

  // Poll until URL changes to the authenticated domain (up to 3 minutes for 2FA)
  const loginDeadline = Date.now() + 180_000;
  while (Date.now() < loginDeadline) {
    await page.waitForTimeout(3000);
    const url = page.url();
    if (
      url.includes("global.americanexpress.com") &&
      !url.includes("login") &&
      !url.includes("challenge")
    ) {
      console.log(`  Detected authenticated URL: ${url}`);
      break;
    }
  }

  // Wait for page content to render
  await page.waitForTimeout(5000);

  // Save session immediately after login
  if (!fs.existsSync(".auth")) fs.mkdirSync(".auth", { recursive: true });
  await context.storageState({ path: authPath });
  console.log(`Session saved to ${authPath}`);

  // ──────────── 3. DASHBOARD ────────────
  console.log("\n=== DASHBOARD ===");
  const dashUrl = page.url();
  console.log(`  Current URL: ${dashUrl}`);
  if (!dashUrl.includes("global.americanexpress.com/dashboard")) {
    await page.goto("https://global.americanexpress.com/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: "output/amex-dashboard.png", fullPage: true });

  const dashEls = await dumpElements(
    page,
    "[data-testid], h1, h2, h3, h4, section, [aria-label], [role='heading']",
    "dashboard"
  );
  safeWriteJSON("output/amex-dashboard-elements.json", dashEls);

  // Dump dollar amounts specifically
  try {
    const dollarAmounts = await page.$$eval(
      "h1, h2, h3, h4, span, p, div, [data-testid]",
      (els) =>
        els
          .map((el) => {
            // Only look at leaf-level text nodes to avoid duplicate parents
            if (el.children.length > 3) return null;
            const text = el.textContent?.trim() || "";
            const match = text.match(/\$[\d,]+\.\d{2}/);
            if (!match) return null;
            return {
              tag: el.tagName,
              testid: el.getAttribute("data-testid") || undefined,
              classes: (typeof el.className === "string" ? el.className : "").slice(0, 100) || undefined,
              amount: match[0],
              fullText: text.slice(0, 200),
            };
          })
          .filter(Boolean)
    );
    safeWriteJSON("output/amex-dashboard-amounts.json", dollarAmounts);
    console.log(`  Found ${dollarAmounts.length} dollar amount elements`);
  } catch (err) {
    console.warn("  Dollar amount scan failed:", err);
  }

  // ──────────── 4. ACTIVITY PAGE ────────────
  console.log("\n=== ACTIVITY PAGE ===");
  await page.goto("https://global.americanexpress.com/activity/recent", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "output/amex-activity.png", fullPage: true });

  const actEls = await dumpElements(
    page,
    "[data-testid], table, tr, [role='row'], [role='listitem'], [role='list'], button, a[href*='download']",
    "activity"
  );
  safeWriteJSON("output/amex-activity-elements.json", actEls);

  // Look for download/export buttons
  try {
    const downloadBtns = await page.$$eval("a, button", (els) =>
      els
        .filter((el) => {
          const text = (el.textContent || "").toLowerCase();
          return (
            text.includes("download") ||
            text.includes("export") ||
            text.includes("csv") ||
            text.includes("statement")
          );
        })
        .map((el) => ({
          tag: el.tagName,
          id: el.id || undefined,
          text: el.textContent?.trim().slice(0, 120),
          href: el.getAttribute("href") || undefined,
          testid: el.getAttribute("data-testid") || undefined,
          ariaLabel: el.getAttribute("aria-label") || undefined,
        }))
    );
    safeWriteJSON("output/amex-download-buttons.json", downloadBtns);
    console.log(`  Found ${downloadBtns.length} download/export buttons`);
  } catch (err) {
    console.warn("  Download button scan failed:", err);
  }

  // ──────────── 5. STATEMENTS PAGE ────────────
  console.log("\n=== STATEMENTS PAGE ===");
  try {
    await page.goto(
      "https://global.americanexpress.com/activity/statements",
      { waitUntil: "domcontentloaded", timeout: 20000 }
    );
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "output/amex-statements.png", fullPage: true });

    const stmtEls = await dumpElements(
      page,
      "[data-testid], button, a[href], select, [role='listbox'], [role='option']",
      "statements"
    );
    safeWriteJSON("output/amex-statements-elements.json", stmtEls);
  } catch (err) {
    console.warn("  Statements page failed:", err);
  }

  // ──────────── 6. OFFERS PAGE ────────────
  console.log("\n=== OFFERS PAGE ===");
  try {
    await page.goto("https://global.americanexpress.com/offers/eligible", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "output/amex-offers.png", fullPage: true });

    // Scroll to load more offers
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: "output/amex-offers-scrolled.png", fullPage: true });

    const offerEls = await dumpElements(
      page,
      "[data-testid], [role='listitem'], button, img[alt], h2, h3, h4, section",
      "offers"
    );
    safeWriteJSON("output/amex-offers-elements.json", offerEls);
  } catch (err) {
    console.warn("  Offers page failed:", err);
  }

  // ──────────── 7. PAYMENT PAGE ────────────
  console.log("\n=== PAYMENT / ACCOUNT SUMMARY ===");
  try {
    await page.goto("https://global.americanexpress.com/payments/summary", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "output/amex-payments.png", fullPage: true });

    const payEls = await dumpElements(
      page,
      "[data-testid], h1, h2, h3, button, [aria-label], section",
      "payments"
    );
    safeWriteJSON("output/amex-payment-elements.json", payEls);
  } catch (err) {
    console.warn("  Payments page failed:", err);
  }

  // ──────────── DONE ────────────
  await context.storageState({ path: authPath });
  console.log(`\nSession saved to ${authPath}`);
  console.log("\nDone! Check output/ directory for screenshots and element dumps.");

  await browser.close();
}

main().catch(console.error);
