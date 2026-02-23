import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { normalizeDate } from "../utils.js";

// Internal type without institution field (added by RobinhoodScraper.scrape)
export type RobinhoodTransactionData = Omit<Transaction, "institution">;

// Month abbreviation → number (for parsing "Feb 13" style dates)
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Parse a short date like "Feb 13" or "Feb 13, 2026" into YYYY-MM-DD.
 * If no year is present, uses the current year.
 */
function parseShortDate(dateStr: string): string {
  // Try "Feb 13, 2026" format first
  const fullMatch = dateStr.match(/(\w{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (fullMatch) {
    const [, mon, day, year] = fullMatch;
    return `${year}-${MONTHS[mon] || "01"}-${day.padStart(2, "0")}`;
  }
  // Try "Feb 13" format (no year)
  const shortMatch = dateStr.match(/(\w{3})\s+(\d{1,2})/);
  if (shortMatch) {
    const [, mon, day] = shortMatch;
    const year = new Date().getFullYear();
    return `${year}-${MONTHS[mon] || "01"}-${day.padStart(2, "0")}`;
  }
  return normalizeDate(dateStr);
}

/**
 * Classify a transaction description into a category.
 */
function classifyTransaction(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("market buy") || d.includes("limit buy")) return "buy";
  if (d.includes("market sell") || d.includes("limit sell")) return "sell";
  if (d.includes("dividend")) return "dividend";
  if (d.includes("deposit")) return "deposit";
  if (d.includes("withdrawal")) return "withdrawal";
  if (d.includes("stock lending")) return "stock_lending";
  if (d.includes("interest")) return "interest";
  return "other";
}

/**
 * Parse a dollar amount string like "$1,241.75" or "+$5,000.00" or "-$100.00"
 */
function parseDollar(str: string): number {
  const cleaned = str.replace(/[+$,]/g, "").replace(/\u2212/g, "-").trim();
  return parseFloat(cleaned) || 0;
}

/**
 * Scrape transaction history from /account/history.
 * Scrolls to load more entries via infinite scroll.
 */
export async function scrapeTransactions(
  page: Page,
  maxScrolls = 10
): Promise<RobinhoodTransactionData[]> {
  console.log("[robinhood] Navigating to history page...");

  await page.goto("https://robinhood.com/account/history", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(5000);

  // Scroll to load more entries
  let previousCount = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const currentCount = await page
      .locator('[data-testid="rh-ExpandableItem-button"]')
      .count();

    if (currentCount === previousCount && i > 0) {
      console.log(
        `[robinhood] No new items after scroll ${i}, stopping at ${currentCount} items`
      );
      break;
    }
    previousCount = currentCount;
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(2000);
  }

  // Extract all activity items from button headers
  const items = await page.$$eval(
    '[data-testid="rh-ExpandableItem-buttonContent"]',
    (els) =>
      els.map((el) => {
        const text = el.textContent?.trim() || "";
        // Find h3 elements — first is description, second is amount
        const h3s = el.querySelectorAll("h3");
        const description = h3s[0]?.textContent?.trim() || "";
        const amountText = h3s[1]?.textContent?.trim() || "";
        // Find the date text — usually a span or div between h3s
        // Look for "Feb 13" style dates in the full text
        return { text, description, amountText };
      })
  );

  console.log(`[robinhood] Found ${items.length} history items`);

  const transactions: RobinhoodTransactionData[] = [];

  for (const item of items) {
    const { description, amountText } = item;
    if (!description || !amountText) continue;

    // Extract date from the full text — look for "Mon DD" or "Mon DD, YYYY" pattern
    const dateMatch = item.text.match(
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?/
    );
    const date = dateMatch ? parseShortDate(dateMatch[0]) : "";
    if (!date) continue;

    const amount = parseDollar(amountText);
    const category = classifyTransaction(description);

    // Determine if it's pending
    const isPending = item.text.toLowerCase().includes("pending");

    // Determine sign: buys and withdrawals are negative (money out)
    // deposits, dividends, stock lending, interest are positive (money in)
    let signedAmount = Math.abs(amount);
    if (category === "buy" || category === "withdrawal") {
      signedAmount = -signedAmount;
    }
    // If the original text had a "+" prefix, it's positive
    if (amountText.startsWith("+")) {
      signedAmount = Math.abs(amount);
    }

    transactions.push({
      date,
      description,
      amount: signedAmount,
      category,
      isPending,
      accountName: "Robinhood Brokerage",
    });
  }

  // Deduplicate: dividend reinvestments show up as both "Dividend from X" and "X Market Buy"
  // Keep both as they represent different actions

  const buys = transactions.filter((t) => t.category === "buy").length;
  const dividends = transactions.filter((t) => t.category === "dividend").length;
  const deposits = transactions.filter((t) => t.category === "deposit").length;
  const lending = transactions.filter((t) => t.category === "stock_lending").length;
  const other = transactions.length - buys - dividends - deposits - lending;

  console.log(
    `[robinhood] Parsed ${transactions.length} transactions: ` +
      `${buys} buys, ${dividends} dividends, ${deposits} deposits, ${lending} stock lending, ${other} other`
  );

  return transactions;
}
