import type { Scraper, ScraperConfig } from "../interface.js";
import type { ScraperResult } from "../../types.js";
import { launchBrowser, saveSession } from "../browser.js";
import { login } from "./login.js";
import { scrapeAccounts } from "./accounts.js";
import { scrapeTransactions } from "./transactions.js";
import { scrapeOffers } from "./offers.js";
import { scrapeRewards } from "./rewards.js";

export class CapitalOneScraper implements Scraper {
  readonly name = "capitalone";
  readonly displayName = "Capital One";

  async scrape(config: ScraperConfig): Promise<ScraperResult> {
    const { browser, context, page } = await launchBrowser(config);

    try {
      const username = config.credentials.username;
      const password = config.credentials.password;
      if (!username || !password) {
        throw new Error(
          "CAPITALONE_USERNAME and CAPITALONE_PASSWORD must be set in .env"
        );
      }

      // Parse card filter from CAPITALONE_CARDS env var
      const cardFilter = parseCardFilter(config.credentials);
      if (cardFilter) {
        console.log(
          `[capitalone] Card filter active: [${cardFilter.join(", ")}]`
        );
      }

      const loggedIn = await login(page, username, password);
      if (!loggedIn) throw new Error("Capital One login failed");
      await saveSession(context, config.authStatePath);

      // Scrape accounts (filtered by card name)
      const { accounts, cardDetails } = await scrapeAccounts(page, cardFilter);

      // Scrape transactions per card
      const transactions = await scrapeTransactions(page, accounts);

      // Scrape card-linked offers
      const offers = await scrapeOffers(page);

      // Scrape rewards details per card
      const rewards = await scrapeRewards(page, accounts);

      await saveSession(context, config.authStatePath);

      return {
        institution: "capitalone",
        accounts: accounts.map((a) => ({ ...a, institution: "capitalone" })),
        transactions: transactions.map((t) => ({
          ...t,
          institution: "capitalone",
        })),
        holdings: [],
        capitalOneCards: cardDetails.length > 0 ? cardDetails : undefined,
        capitalOneOffers: offers.length > 0 ? offers : undefined,
        capitalOneRewards: rewards.length > 0 ? rewards : undefined,
      };
    } finally {
      await browser.close();
    }
  }
}

/**
 * Parse CAPITALONE_CARDS or CAPITALONE_CARD env var into a filter list.
 * Returns null if no filter is set (scrape all cards).
 *
 * The config loader strips the CAPITALONE_ prefix and lowercases keys,
 * so CAPITALONE_CARDS becomes credentials.cards, CAPITALONE_CARD becomes credentials.card.
 */
function parseCardFilter(
  credentials: Record<string, string>
): string[] | null {
  const raw = credentials.cards || credentials.card;
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
