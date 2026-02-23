import type { Scraper, ScraperConfig } from "../interface.js";
import type { ScraperResult } from "../../types.js";
import { launchBrowser, saveSession } from "../browser.js";
import { login } from "./login.js";
import { scrapeAccounts } from "./accounts.js";
import { scrapeHoldings } from "./holdings.js";

export class RobinhoodScraper implements Scraper {
  readonly name = "robinhood";
  readonly displayName = "Robinhood";

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { browser, context, page } = await launchBrowser(config);

    try {
      const username = config.credentials.username;
      const password = config.credentials.password;
      if (!username || !password) {
        throw new Error(
          "ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD must be set in .env"
        );
      }

      const loggedIn = await login(page, username, password);
      if (!loggedIn) throw new Error("Robinhood login failed");
      await saveSession(context, config.authStatePath);

      const accounts = await scrapeAccounts(page);
      const holdings = await scrapeHoldings(page);
      await saveSession(context, config.authStatePath);

      return {
        institution: "robinhood",
        accounts: accounts.map((a) => ({ ...a, institution: "robinhood" })),
        transactions: [],
        holdings: holdings.map((h) => ({ ...h, institution: "robinhood" })),
      };
    } finally {
      await browser.close();
    }
  }
}
