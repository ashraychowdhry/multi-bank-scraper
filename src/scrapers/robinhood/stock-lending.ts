import type { Page } from "playwright";
import type { StockLendingIncome } from "../../types.js";
import { parseBalance } from "../utils.js";

/**
 * Scrape stock lending income from /account/stock-lending.
 * Page shows:
 * - h2 with "$18.54" (last month) and "$231.17" (total)
 * - List of stocks on loan: links like "FIGFigma1 share"
 */
export async function scrapeStockLending(
  page: Page
): Promise<StockLendingIncome | null> {
  console.log("[robinhood] Navigating to stock lending page...");

  try {
    await page.goto("https://robinhood.com/account/stock-lending", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(4000);

    // Extract the two h2 dollar amounts — first is "last month", second is "total"
    const dollarH2s = await page.$$eval("h2", (els) =>
      els
        .map((el) => el.textContent?.trim() || "")
        .filter((t) => t.startsWith("$"))
    );

    const lastMonth =
      dollarH2s.length >= 1 ? parseBalance(dollarH2s[0]) : 0;
    const total = dollarH2s.length >= 2 ? parseBalance(dollarH2s[1]) : 0;

    // Extract stocks on loan from links
    const stockLinks = await page.$$eval(
      'a[href^="/stocks/"]',
      (els) =>
        els
          .map((el) => el.textContent?.trim() || "")
          .filter((t) => t.includes("share"))
    );

    const stocksOnLoan: StockLendingIncome["stocksOnLoan"] = [];
    for (const text of stockLinks) {
      // Format: "FIGFigma1 share" or "PSNYPolestar Automotive83 shares"
      // Ticker is all-caps at the start, followed by name, then number + "share(s)"
      const sharesMatch = text.match(/(\d+)\s+shares?$/);
      if (!sharesMatch) continue;

      const shares = parseInt(sharesMatch[1], 10);
      const beforeShares = text.slice(0, sharesMatch.index).trim();

      // Split ticker from name: ticker is the all-caps prefix
      const tickerMatch = beforeShares.match(/^([A-Z]+)/);
      if (!tickerMatch) continue;

      const ticker = tickerMatch[1];
      const name = beforeShares.slice(ticker.length).trim() || ticker;

      stocksOnLoan.push({ ticker, name, shares });
    }

    console.log(
      `[robinhood] Stock lending: $${lastMonth} last month, $${total} total, ${stocksOnLoan.length} stocks on loan`
    );

    return { lastMonth, total, stocksOnLoan };
  } catch (e) {
    console.warn("[robinhood] Could not scrape stock lending:", e);
    return null;
  }
}
