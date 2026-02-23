import type { Page } from "playwright";
import type { Holding } from "../../types.js";

// Internal type without institution field (added by RobinhoodScraper.scrape)
export type RobinhoodHoldingData = Omit<Holding, "institution">;

/**
 * Parse a holding link's text from the /account/investing page.
 * Text format: "{Name}{TICKER}{shares}${price}${avgCost}${totalReturn}${equity}"
 * Example: "Applied DigitalAPLD1,115$29.62$7.01$25,209.01$33,026.41"
 */
function parseHoldingLink(
  text: string,
  ticker: string
): RobinhoodHoldingData | null {
  // Find where ticker+digit starts (distinguishes ticker from name that might contain ticker)
  const tickerDigitRegex = new RegExp(ticker + "(\\d)");
  const match = text.match(tickerDigitRegex);
  if (!match || match.index === undefined) return null;

  const name = text.slice(0, match.index).trim() || ticker;
  const dataStr = text.slice(match.index + ticker.length);

  // dataStr: "1,115$29.62$7.01$25,209.01$33,026.41"
  const parts = dataStr.split("$");
  if (parts.length < 5) return null;

  const shares = parseFloat(parts[0].replace(/,/g, ""));
  const currentPrice = parseFloat(parts[1].replace(/,/g, ""));
  // parts[2] = average cost per share
  const avgCostPerShare = parseFloat(parts[2].replace(/,/g, ""));
  // parts[3] = total return (absolute value — sign determined by computation)
  // parts[4] = equity (current value)
  const currentValue = parseFloat(parts[4].replace(/,/g, ""));

  if (isNaN(shares) || isNaN(currentPrice) || isNaN(currentValue)) return null;

  const costBasis = avgCostPerShare * shares;
  const gainLoss = currentValue - costBasis;
  const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

  return {
    ticker,
    name,
    shares,
    currentPrice,
    currentValue,
    costBasis: Math.round(costBasis * 100) / 100,
    gainLoss: Math.round(gainLoss * 100) / 100,
    gainLossPercent: Math.round(gainLossPercent * 100) / 100,
  };
}

export async function scrapeHoldings(
  page: Page
): Promise<RobinhoodHoldingData[]> {
  console.log("[robinhood] Navigating to account holdings page...");

  await page.goto("https://robinhood.com/account/investing", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(5000);

  // Collect all holding links: /stocks/TICKER or /crypto/TICKER
  const holdingLinks = await page.$$eval(
    'a[href^="/stocks/"], a[href^="/crypto/"]',
    (els) =>
      els
        .map((el) => ({
          href: el.getAttribute("href") || "",
          text: el.textContent?.trim() || "",
        }))
        .filter((l) => l.text.includes("$"))
  );

  console.log(
    `[robinhood] Found ${holdingLinks.length} holding links on account page`
  );

  const holdings: RobinhoodHoldingData[] = [];

  for (const link of holdingLinks) {
    // Extract ticker from href: /stocks/APLD or /crypto/XRP (strip query params)
    const hrefPath = link.href.split("?")[0];
    const ticker = hrefPath.split("/").pop() || "";
    if (!ticker) continue;

    const holding = parseHoldingLink(link.text, ticker);
    if (holding) {
      holdings.push(holding);
    } else {
      console.warn(
        `[robinhood] Could not parse holding: ${ticker} — "${link.text.slice(0, 60)}"`
      );
    }
  }

  const stocks = holdings.filter((h) =>
    holdingLinks.some(
      (l) => l.href.startsWith("/stocks/") && l.href.includes(h.ticker)
    )
  );
  const crypto = holdings.filter((h) =>
    holdingLinks.some(
      (l) => l.href.startsWith("/crypto/") && l.href.includes(h.ticker)
    )
  );

  console.log(
    `[robinhood] Scraped ${stocks.length} stocks + ${crypto.length} crypto = ${holdings.length} holdings`
  );
  return holdings;
}
