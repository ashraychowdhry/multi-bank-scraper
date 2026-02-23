// Temporary: run with `npx tsx src/debug-robinhood.ts`
// Opens Robinhood in headed mode for DOM inspection.
// Delete this file after selectors are discovered.

import { chromium } from "playwright";
import * as fs from "node:fs";

const DUMP_DIR = "output/debug";

async function dumpPageInfo(page: import("playwright").Page, label: string) {
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

  const url = page.url();
  console.log(`\n=== DUMP: ${label} ===`);
  console.log(`URL: ${url}`);

  // Screenshot
  const screenshotPath = `${DUMP_DIR}/${label}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot: ${screenshotPath}`);

  // Collect all input fields
  const inputs = await page.$$eval("input", (els) =>
    els.map((el) => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      "data-testid": el.getAttribute("data-testid"),
      "aria-label": el.getAttribute("aria-label"),
      className: el.className.slice(0, 80),
    }))
  );

  // Collect all buttons
  const buttons = await page.$$eval("button", (els) =>
    els.map((el) => ({
      text: el.textContent?.trim().slice(0, 60),
      type: el.type,
      id: el.id,
      "data-testid": el.getAttribute("data-testid"),
      "aria-label": el.getAttribute("aria-label"),
      className: el.className.slice(0, 80),
    }))
  );

  // Collect data-testid elements
  const testIds = await page.$$eval("[data-testid]", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      "data-testid": el.getAttribute("data-testid"),
      text: el.textContent?.trim().slice(0, 80),
    }))
  );

  // Collect role attributes
  const roles = await page.$$eval("[role]", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      "aria-label": el.getAttribute("aria-label"),
      text: el.textContent?.trim().slice(0, 60),
    }))
  );

  // Collect all links
  const links = await page.$$eval("a[href]", (els) =>
    els.map((el) => ({
      href: el.getAttribute("href"),
      text: el.textContent?.trim().slice(0, 60),
    }))
  );

  const dump = { url, inputs, buttons, testIds, roles, links };
  const dumpPath = `${DUMP_DIR}/${label}.json`;
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  console.log(`DOM dump: ${dumpPath}`);
  console.log(`  ${inputs.length} inputs, ${buttons.length} buttons, ${testIds.length} data-testid elements, ${roles.length} role elements, ${links.length} links`);
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log("Navigating to Robinhood login page...\n");
  await page.goto("https://robinhood.com/login/");
  await page.waitForTimeout(3000);

  // Dump the login page
  await dumpPageInfo(page, "01-login-page");

  console.log("\n==========================================");
  console.log("  LOG IN MANUALLY IN THE BROWSER WINDOW");
  console.log("==========================================");
  console.log("Complete login + 2FA, then wait here.\n");
  console.log("Polling for login completion...");

  // Poll until we leave the login page
  const deadline = Date.now() + 300_000; // 5 min
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const url = page.url();
    if (!url.includes("/login") && !url.includes("/challenge")) {
      console.log(`\nLogin detected! URL: ${url}`);
      break;
    }
  }

  // Wait for page to fully load after login
  await page.waitForTimeout(5000);
  await dumpPageInfo(page, "02-after-login");

  // Save session for reuse
  if (!fs.existsSync(".auth")) fs.mkdirSync(".auth", { recursive: true });
  await context.storageState({ path: ".auth/robinhood-state.json" });
  console.log("\nSession saved to .auth/robinhood-state.json");

  console.log("\n==========================================");
  console.log("  LOGGED IN — EXPLORING PAGES");
  console.log("==========================================");
  console.log("Keeping browser open. Press Ctrl+C when done.\n");

  // Keep alive
  await new Promise(() => {});
}

main();
