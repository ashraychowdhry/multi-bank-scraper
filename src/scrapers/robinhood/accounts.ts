import type { Page } from "playwright";
import type { Account, CashInterest } from "../../types.js";
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

/**
 * Scrape cash balance from the /account/investing page.
 * Call this AFTER scrapeHoldings, since the page is already navigated there.
 * Table text: "Individual Cash$31,260.16Withdrawable Cash$31,260.16"
 */
export async function scrapeCash(
  page: Page
): Promise<RobinhoodAccountData | null> {
  try {
    const tables = await page.$$eval("table", (els) =>
      els.map((el) => el.textContent?.trim() || "")
    );
    const cashTable = tables.find((t) => t.includes("Individual Cash"));
    if (!cashTable) return null;

    const match = cashTable.match(/Individual Cash\$([\d,]+\.\d{2})/);
    if (!match) return null;

    const cashBalance = parseBalance(`$${match[1]}`);
    console.log(`[robinhood] Cash balance: $${cashBalance.toLocaleString()}`);

    return {
      name: "Robinhood Cash",
      type: "checking",
      currentBalance: cashBalance,
      accountNumber: "RH-CASH",
    };
  } catch (e) {
    console.warn("[robinhood] Could not scrape cash balance:", e);
    return null;
  }
}

/**
 * Scrape cash interest data from the /account/investing page.
 * Call this AFTER scrapeHoldings, since the page is already navigated there.
 * Table text: "Annual percentage yield (APY)3.35%Cash earning interest$31,260.16Interest accrued this month$64.25Lifetime interest paid$8,722.91"
 */
export async function scrapeCashInterest(
  page: Page
): Promise<CashInterest | null> {
  try {
    const tables = await page.$$eval("table", (els) =>
      els.map((el) => el.textContent?.trim() || "")
    );
    const interestTable = tables.find((t) =>
      t.includes("Annual percentage yield")
    );
    if (!interestTable) return null;

    const apyMatch = interestTable.match(
      /Annual percentage yield \(APY\)([\d.]+)%/
    );
    const earningMatch = interestTable.match(
      /Cash earning interest\$([\d,]+\.\d{2})/
    );
    const accruedMatch = interestTable.match(
      /Interest accrued this month\$([\d,]+\.\d{2})/
    );
    const lifetimeMatch = interestTable.match(
      /Lifetime interest paid\$([\d,]+\.\d{2})/
    );

    const result: CashInterest = {
      apy: apyMatch ? parseFloat(apyMatch[1]) : 0,
      cashEarningInterest: earningMatch
        ? parseBalance(`$${earningMatch[1]}`)
        : 0,
      interestAccruedThisMonth: accruedMatch
        ? parseBalance(`$${accruedMatch[1]}`)
        : 0,
      lifetimeInterestPaid: lifetimeMatch
        ? parseBalance(`$${lifetimeMatch[1]}`)
        : 0,
    };

    console.log(
      `[robinhood] Cash interest: ${result.apy}% APY, $${result.interestAccruedThisMonth} this month, $${result.lifetimeInterestPaid} lifetime`
    );
    return result;
  } catch (e) {
    console.warn("[robinhood] Could not scrape cash interest:", e);
    return null;
  }
}
