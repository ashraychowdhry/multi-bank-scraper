/**
 * Debug script to discover the Capital One rewards page structure.
 * Navigates to each card's rewards page and dumps the DOM structure.
 *
 * Usage: npx tsx src/debug-capitalone-rewards.ts
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

async function dumpElements(
  page: import("playwright").Page,
  selector: string,
  label: string
) {
  try {
    const els = await page.$$eval(selector, (nodes) =>
      nodes.map((el) => ({
        tag: el.tagName,
        id: el.id || undefined,
        testid: el.getAttribute("data-testid") || undefined,
        role: el.getAttribute("role") || undefined,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        href: el.getAttribute("href")?.slice(0, 120) || undefined,
        classes:
          (typeof el.className === "string" ? el.className : "").slice(
            0,
            150
          ) || undefined,
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

  // Find card IDs from the dashboard
  const cardIds = await page.evaluate(() => {
    const buttons = document.querySelectorAll(
      'button[data-testid^="summary-"]'
    );
    return Array.from(buttons).map((btn) => ({
      testId: btn.getAttribute("data-testid") || "",
      text: btn.textContent?.trim() || "",
    }));
  });

  console.log(`Found ${cardIds.length} card button(s):`);
  for (const card of cardIds) {
    console.log(`  ${card.testId}: "${card.text}"`);
  }

  if (!fs.existsSync("output")) {
    fs.mkdirSync("output", { recursive: true });
  }

  // Navigate to rewards page for each card
  for (const card of cardIds) {
    const cardId = card.testId.replace(/^summary-/, "");
    if (!cardId) continue;

    const rewardsUrl = `https://myaccounts.capitalone.com/Card/${encodeURIComponent(cardId)}/rewards`;
    console.log(`\n--- Navigating to rewards: ${rewardsUrl} ---`);

    await page.goto(rewardsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    if (!currentUrl.includes("/rewards")) {
      console.log("  Redirected away from rewards page — skipping");
      continue;
    }

    // Screenshot
    const screenshotPath = `output/debug-rewards-${cardId.slice(0, 20)}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  Screenshot: ${screenshotPath}`);

    // Dump key elements
    const headings = await dumpElements(page, "h1, h2, h3, h4", "headings");
    const testids = await dumpElements(
      page,
      "[data-testid]",
      "data-testid elements"
    );
    const dollarAmounts = await dumpElements(
      page,
      'text=/\\$[\\d,]+\\.\\d{2}/',
      "dollar amounts"
    );
    const links = await dumpElements(page, "a[href]", "links");
    const tables = await dumpElements(page, "table", "tables");

    // Body text for pattern matching
    const bodyText = await page.evaluate(
      () => document.body.textContent?.slice(0, 5000) || ""
    );

    // Look for rewards-specific patterns
    const milesMatch = bodyText.match(/([\d,]+)\s*Miles?/i);
    const cashMatch = bodyText.match(
      /\$([\d,]+(?:\.\d{2})?)\s*(?:Rewards?\s*Cash|Cash\s*Back)/i
    );
    const pointsMatch = bodyText.match(/([\d,]+)\s*Points?/i);

    console.log(
      `  Miles pattern: ${milesMatch ? milesMatch[0] : "not found"}`
    );
    console.log(
      `  Cash pattern: ${cashMatch ? cashMatch[0] : "not found"}`
    );
    console.log(
      `  Points pattern: ${pointsMatch ? pointsMatch[0] : "not found"}`
    );

    const dumpFile = `output/debug-rewards-${cardId.slice(0, 20)}.json`;
    safeWriteJSON(dumpFile, {
      url: currentUrl,
      cardId,
      headings,
      testids,
      dollarAmounts,
      links,
      tables,
      bodyTextPreview: bodyText.slice(0, 2000),
      patterns: {
        miles: milesMatch?.[0] || null,
        cash: cashMatch?.[0] || null,
        points: pointsMatch?.[0] || null,
      },
    });
    console.log(`  Dump: ${dumpFile}`);
  }

  // Keep browser open for manual inspection
  console.log(
    "\nBrowser will stay open for 60s for manual inspection..."
  );
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);
