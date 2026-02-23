import type { Page } from "playwright";
import type { Account } from "../../types.js";
import { parseBalance } from "../utils.js";

// Internal type without institution field (added by RobinhoodScraper.scrape)
export type RobinhoodAccountData = Omit<Account, "institution">;

export async function scrapeAccounts(
  page: Page
): Promise<RobinhoodAccountData[]> {
  console.log("[robinhood] Scraping account balances...");

  const accounts: RobinhoodAccountData[] = [];

  // Portfolio value from h2[data-testid="PortfolioValue"]
  // Text contains animation chars: "$264,497.45$264,497.459876543210..."
  // Extract the first dollar amount
  try {
    const portfolioEl = page.locator('[data-testid="PortfolioValue"]');
    const rawText = (await portfolioEl.textContent()) || "";
    const match = rawText.match(/\$([\d,]+\.\d{2})/);
    const portfolioValue = match ? parseBalance(match[0]) : 0;

    accounts.push({
      name: "Robinhood Brokerage",
      type: "brokerage",
      currentBalance: portfolioValue,
      accountNumber: "RH-BROKERAGE",
    });
    console.log(
      `[robinhood] Portfolio value: $${portfolioValue.toLocaleString()}`
    );
  } catch (e) {
    console.warn("[robinhood] Could not scrape portfolio value:", e);
  }

  // Buying power from button with text "Buying power$XXX,XXX.XX"
  try {
    const buyingPowerBtn = page.locator('button:has-text("Buying power")');
    const btnText = (await buyingPowerBtn.first().textContent()) || "";
    const match = btnText.match(/Buying power\$([\d,]+\.\d{2})/);
    if (match) {
      const buyingPower = parseBalance(`$${match[1]}`);
      accounts[0].availableBalance = buyingPower;
      console.log(
        `[robinhood] Buying power: $${buyingPower.toLocaleString()}`
      );
    }
  } catch (e) {
    console.warn("[robinhood] Could not scrape buying power:", e);
  }

  return accounts;
}
