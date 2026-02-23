// Temporary: explore Robinhood pages for scrapeable data
// Run with: npx tsx src/debug-robinhood-explore.ts

import { chromium } from "playwright";
import * as fs from "node:fs";

const DUMP_DIR = "output/debug/explore";

async function dumpPage(page: import("playwright").Page, label: string) {
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

  const url = page.url();
  console.log(`\n=== ${label} === (${url})`);

  await page.screenshot({ path: `${DUMP_DIR}/${label}.png`, fullPage: true });

  const testIds = await page.$$eval("[data-testid]", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      "data-testid": el.getAttribute("data-testid"),
      text: el.textContent?.trim().slice(0, 150),
    }))
  );

  const tables = await page.$$eval("table", (els) =>
    els.map((el, i) => ({
      index: i,
      rows: el.querySelectorAll("tr").length,
      text: el.textContent?.trim().slice(0, 300),
    }))
  );

  const links = await page.$$eval("a[href]", (els) =>
    els.map((el) => ({
      href: el.getAttribute("href"),
      text: el.textContent?.trim().slice(0, 80),
    })).filter((l) => l.href && !l.href.startsWith("http") && l.text)
  );

  const headings = await page.$$eval("h1, h2, h3, h4", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 100),
    }))
  );

  // Look for list items and spans with dollar amounts
  const dollarElements = await page.$$eval("*", (els) =>
    els
      .filter((el) => {
        const text = el.textContent?.trim() || "";
        return text.match(/^\$[\d,]+\.?\d*$/) && el.children.length === 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        class: el.className?.toString().slice(0, 40),
        text: el.textContent?.trim(),
        parent: el.parentElement?.textContent?.trim().slice(0, 100),
      }))
      .slice(0, 30)
  );

  const dump = { url, headings, testIds, tables, links, dollarElements };
  const dumpPath = `${DUMP_DIR}/${label}.json`;
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  console.log(`  ${headings.length} headings, ${testIds.length} testids, ${tables.length} tables, ${links.length} links`);
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
    viewport: { width: 1280, height: 900 },
    storageState: ".auth/robinhood-state.json",
  });

  const page = await context.newPage();

  const pages = [
    { url: "https://robinhood.com/account/history", label: "history", wait: 5000 },
    { url: "https://robinhood.com/cash", label: "cash-spending", wait: 5000 },
    { url: "https://robinhood.com/account/reports-statements", label: "reports", wait: 5000 },
    { url: "https://robinhood.com/account/recurring", label: "recurring", wait: 3000 },
    { url: "https://robinhood.com/account/tax-center", label: "tax-center", wait: 3000 },
    { url: "https://robinhood.com/retirement", label: "retirement", wait: 3000 },
    { url: "https://robinhood.com/account/stock-lending", label: "stock-lending", wait: 3000 },
  ];

  for (const p of pages) {
    try {
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(p.wait);
      await dumpPage(page, p.label);
    } catch (e) {
      console.log(`  FAILED: ${p.url} — ${e}`);
    }
  }

  // Also explore the history page more — scroll to load more entries
  console.log("\n=== Scrolling history page to load more entries ===");
  try {
    await page.goto("https://robinhood.com/account/history", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(5000);

    // Scroll down a few times to load more history
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(2000);
    }
    await dumpPage(page, "history-scrolled");
  } catch (e) {
    console.log(`  FAILED scrolling history: ${e}`);
  }

  // Explore the /account/investing page for cash/margin/APY detail
  try {
    await page.goto("https://robinhood.com/account/investing", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(5000);
    await dumpPage(page, "investing-detail");
  } catch (e) {
    console.log(`  FAILED: investing-detail — ${e}`);
  }

  console.log("\n==========================================");
  console.log("  EXPLORATION DONE — Ctrl+C to close");
  console.log("==========================================\n");

  await new Promise(() => {});
}

main();
