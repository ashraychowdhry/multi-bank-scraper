import type { Scraper, ScraperConfig } from "../interface.js";
import type { ScraperResult } from "../../types.js";
import { launchBrowser, saveSession } from "../browser.js";
import { login } from "./login.js";
import { buildAccountsFromCSV } from "./accounts.js";
import { scrapeHoldings } from "./holdings.js";
import { scrapeTransactions } from "./transactions.js";

export class FidelityScraper implements Scraper {
  readonly name = "fidelity";
  readonly displayName = "Fidelity";

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { browser, context, page } = await launchBrowser(config);

    try {
      const username = config.credentials.username;
      const password = config.credentials.password;
      if (!username || !password) {
        throw new Error(
          "FIDELITY_USERNAME and FIDELITY_PASSWORD must be set in .env"
        );
      }

      const loggedIn = await login(page, username, password);
      if (!loggedIn) throw new Error("Fidelity login failed");
      await saveSession(context, config.authStatePath);

      // Scrape holdings from positions CSV — also gives us account data
      const holdingsWithAccounts = await scrapeHoldings(page);
      const accounts = buildAccountsFromCSV(holdingsWithAccounts);

      // Scrape transactions from activity history
      const transactions = await scrapeTransactions(page);
      await saveSession(context, config.authStatePath);

      // Strip internal accountNumber from holdings but keep accountName for dashboard
      const holdings = holdingsWithAccounts.map((h) => ({
        ticker: h.ticker,
        name: h.name,
        shares: h.shares,
        currentPrice: h.currentPrice,
        currentValue: h.currentValue,
        costBasis: h.costBasis,
        gainLoss: h.gainLoss,
        gainLossPercent: h.gainLossPercent,
        accountName: h.accountName,
      }));

      return {
        institution: "fidelity",
        accounts: accounts.map((a) => ({ ...a, institution: "fidelity" })),
        transactions: transactions.map((t) => ({
          ...t,
          institution: "fidelity",
        })),
        holdings: holdings.map((h) => ({ ...h, institution: "fidelity" })),
      };
    } finally {
      await browser.close();
    }
  }
}
