import type { Scraper, ScraperConfig } from "../interface.js";
import type { ScraperResult } from "../../types.js";
import { launchBrowser, saveSession } from "../browser.js";
import { login } from "./login.js";
import { scrapeAccounts } from "./accounts.js";
import { scrapeTransactions } from "./transactions.js";
import { scrapeOffers } from "./offers.js";
import { scrapeRewards } from "./rewards.js";

export class AmexScraper implements Scraper {
  readonly name = "amex";
  readonly displayName = "American Express";

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { browser, context, page } = await launchBrowser(config);

    try {
      const username = config.credentials.username;
      const password = config.credentials.password;
      if (!username || !password) {
        throw new Error(
          "AMEX_USERNAME and AMEX_PASSWORD must be set in .env"
        );
      }

      const loggedIn = await login(page, username, password);
      if (!loggedIn) throw new Error("Amex login failed");
      await saveSession(context, config.authStatePath);

      // Scrape account summary + card details
      const { accounts, cardDetails } = await scrapeAccounts(page);

      // Scrape transactions (includes payments in the activity list)
      const accountName =
        accounts.length > 0 ? accounts[0].name : "Amex Card";
      const transactions = await scrapeTransactions(page, accountName);

      // Scrape Amex Offers
      const offers = await scrapeOffers(page);

      // Scrape Membership Rewards points
      const rewards = await scrapeRewards(page, accountName);

      await saveSession(context, config.authStatePath);

      return {
        institution: "amex",
        accounts: accounts.map((a) => ({ ...a, institution: "amex" })),
        transactions: transactions.map((t) => ({
          ...t,
          institution: "amex",
        })),
        holdings: [],
        amexCardDetails: cardDetails || undefined,
        amexOffers: offers.length > 0 ? offers : undefined,
        amexRewards: rewards || undefined,
      };
    } finally {
      await browser.close();
    }
  }
}
