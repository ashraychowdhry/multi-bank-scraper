import type { Scraper, ScraperConfig } from "../interface.js";
import type { ScraperResult } from "../../types.js";
import { launchBrowser, saveSession } from "../browser.js";
import { login } from "./login.js";
import { scrapeAccounts } from "./accounts.js";
import { scrapeTransactions } from "./transactions.js";

export class ChaseScraper implements Scraper {
  readonly name = "chase";
  readonly displayName = "Chase";

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { browser, context, page } = await launchBrowser(config);

    try {
      const username = config.credentials.username;
      const password = config.credentials.password;
      if (!username || !password) {
        throw new Error("CHASE_USERNAME and CHASE_PASSWORD must be set in .env");
      }

      const loggedIn = await login(page, username, password);
      if (!loggedIn) throw new Error("Chase login failed");
      await saveSession(context, config.authStatePath);

      const accounts = await scrapeAccounts(page);
      const transactions = await scrapeTransactions(page, accounts);
      await saveSession(context, config.authStatePath);

      return {
        institution: "chase",
        accounts: accounts.map((a) => ({ ...a, institution: "chase" })),
        transactions: transactions.map((t) => ({ ...t, institution: "chase" })),
        holdings: [],
      };
    } finally {
      await browser.close();
    }
  }
}
