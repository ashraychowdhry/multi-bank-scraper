import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config.js";
import {
  launchBrowser,
  login,
  saveSession,
  scrapeAccounts,
  scrapeTransactions,
} from "./scraper.js";
import { ScrapeResult } from "./types.js";

async function main() {
  console.log("=== Chase Bank Scraper ===\n");

  const config = loadConfig();
  const { browser, context, page } = await launchBrowser(config);

  try {
    // Login
    const loggedIn = await login(page, config);
    if (!loggedIn) {
      console.error("Failed to log in. Exiting.");
      process.exit(1);
    }

    await saveSession(context, config);

    // Scrape
    const accounts = await scrapeAccounts(page);
    const transactions = await scrapeTransactions(page, accounts);

    // Output
    const result: ScrapeResult = {
      scrapedAt: new Date().toISOString(),
      accounts,
      transactions,
    };

    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
    }

    const outputFile = path.join(
      config.outputDir,
      `chase-${new Date().toISOString().split("T")[0]}.json`
    );
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    console.log(`\nResults written to: ${outputFile}`);

    // Summary
    console.log("\n=== Account Summary ===");
    for (const acct of accounts) {
      console.log(
        `  ${acct.name} (${acct.type}): $${acct.currentBalance.toFixed(2)}`
      );
    }
    console.log(`\n${transactions.length} transaction(s) scraped.`);

    await saveSession(context, config);
  } catch (err) {
    console.error("Scraper error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
