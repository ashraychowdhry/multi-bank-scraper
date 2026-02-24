/**
 * Debug script to discover the Custom Date Range form in Capital One's
 * Download Transactions dialog. Run headed to see the dialog and inspect elements.
 *
 * Usage: npx tsx src/debug-capitalone-daterange.ts
 */
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

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const authPath = ".auth/capitalone-state.json";
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
  };

  if (fs.existsSync(authPath)) {
    contextOptions.storageState = authPath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log("Navigating to Capital One dashboard...");
  await page.goto("https://myaccounts.capitalone.com/accountSummary", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);

  // Click first "View Account" button to get to card detail page
  const viewBtn = page.locator('button:has-text("View Account")').first();
  if (await viewBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("Clicking View Account...");
    await viewBtn.click();
    await page.waitForTimeout(5000);
  } else {
    console.log("No View Account button found — are you logged in?");
    await page.waitForTimeout(60000);
    await browser.close();
    return;
  }

  // Scroll down and find Download Transactions
  await page.evaluate(() => window.scrollBy(0, 3000));
  await page.waitForTimeout(2000);

  const dlBtn = page.locator('button:has-text("Download Transactions")').first();
  if (await dlBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("Clicking Download Transactions...");
    await dlBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await dlBtn.click();
    await page.waitForTimeout(3000);
  } else {
    console.log("No Download Transactions button found");
    await page.waitForTimeout(60000);
    await browser.close();
    return;
  }

  // Select CSV file type first
  const dialog = page.locator('[role="dialog"]').first();
  const fileTypeDropdown = dialog.locator("c1-ease-select").first();
  if (await fileTypeDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fileTypeDropdown.click();
    await page.waitForTimeout(1000);
    const csvOption = page.locator('.cdk-overlay-pane [role="option"]:has-text("CSV")').first();
    if (await csvOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await csvOption.click();
      await page.waitForTimeout(1000);
    }
  }

  // Now select "Custom Date Range" from the time period dropdown
  const timePeriodDropdown = dialog.locator("c1-ease-select").nth(1);
  if (await timePeriodDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log("Opening Time Period dropdown...");
    await timePeriodDropdown.click();
    await page.waitForTimeout(1000);

    // List all options
    const options = page.locator('.cdk-overlay-pane [role="option"]');
    const optionCount = await options.count();
    console.log(`Found ${optionCount} time period options:`);
    for (let i = 0; i < optionCount; i++) {
      const text = await options.nth(i).textContent();
      console.log(`  ${i}: "${text?.trim()}"`);
    }

    // Select "Custom Date Range"
    const customOption = page.locator('.cdk-overlay-pane [role="option"]:has-text("Custom Date Range")').first();
    if (await customOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Selecting "Custom Date Range"...');
      await customOption.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('"Custom Date Range" not found among options');
    }
  }

  // Now dump the dialog DOM to see date input fields
  console.log("\nDumping dialog DOM after selecting Custom Date Range...");
  const dialogHTML = await dialog.innerHTML().catch(() => "");
  safeWriteJSON("output/debug-daterange-dialog.json", { dialogHTML });

  // Dump all inputs, selects, and date-related elements
  const elements = await dialog.evaluate((el) => {
    const results: Record<string, unknown>[] = [];
    const allEls = el.querySelectorAll("input, select, c1-ease-date-input, [type='date'], [placeholder]");
    for (const e of allEls) {
      results.push({
        tag: e.tagName,
        id: e.id || undefined,
        type: e.getAttribute("type") || undefined,
        name: e.getAttribute("name") || undefined,
        placeholder: e.getAttribute("placeholder") || undefined,
        ariaLabel: e.getAttribute("aria-label") || undefined,
        value: (e as HTMLInputElement).value || undefined,
        classes: (typeof e.className === "string" ? e.className : "").slice(0, 150),
      });
    }
    return results;
  });

  console.log(`\nFound ${elements.length} form elements in dialog:`);
  for (const el of elements) {
    console.log(`  ${JSON.stringify(el)}`);
  }

  safeWriteJSON("output/debug-daterange-elements.json", elements);

  // Take screenshot
  await page.screenshot({ path: "output/debug-daterange-dialog.png", fullPage: false });
  console.log("\nScreenshot saved to output/debug-daterange-dialog.png");

  // Keep browser open for manual inspection
  console.log("\nBrowser will stay open for 60s for manual inspection...");
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);
