import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadGlobalConfig, loadScraperConfig } from "./config.js";
import { scraperRegistry } from "./scrapers/registry.js";
import type { ScrapeResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

async function main() {
  console.log("=== Bank Scraper ===\n");

  const globalConfig = loadGlobalConfig();
  const enabledScrapers = globalConfig.enabledScrapers;
  console.log(`Enabled scrapers: ${enabledScrapers.join(", ")}\n`);

  const combined: ScrapeResult = {
    scrapedAt: new Date().toISOString(),
    accounts: [],
    transactions: [],
    holdings: [],
  };
  // Collect optional data from scrapers that provide it
  let cashInterest: ScrapeResult["cashInterest"];
  let stockLending: ScrapeResult["stockLending"];
  let allOffers: ScrapeResult["offers"];
  let amexOffers: ScrapeResult["amexOffers"];
  let amexCardDetails: ScrapeResult["amexCardDetails"];
  let capitalOneCards: ScrapeResult["capitalOneCards"];
  let capitalOneOffers: ScrapeResult["capitalOneOffers"];
  let capitalOneRewards: ScrapeResult["capitalOneRewards"];

  for (const name of enabledScrapers) {
    const factory = scraperRegistry[name];
    if (!factory) {
      console.warn(`Unknown scraper: "${name}" — skipping.`);
      continue;
    }

    const scraperConfig = loadScraperConfig(name, globalConfig);
    const scraper = factory();

    console.log(`\n--- Running ${scraper.displayName} scraper ---\n`);
    try {
      const result = await scraper.scrape(scraperConfig);
      combined.accounts.push(...result.accounts);
      combined.transactions.push(...result.transactions);
      combined.holdings.push(...result.holdings);
      if (result.cashInterest) cashInterest = result.cashInterest;
      if (result.stockLending) stockLending = result.stockLending;
      if (result.offers) {
        allOffers = allOffers || [];
        allOffers.push(...result.offers);
      }
      if (result.amexOffers) amexOffers = result.amexOffers;
      if (result.amexCardDetails) amexCardDetails = result.amexCardDetails;
      if (result.capitalOneCards) capitalOneCards = result.capitalOneCards;
      if (result.capitalOneOffers) capitalOneOffers = result.capitalOneOffers;
      if (result.capitalOneRewards) capitalOneRewards = result.capitalOneRewards;
      console.log(
        `\n${scraper.displayName}: ${result.accounts.length} account(s), ` +
          `${result.transactions.length} transaction(s), ` +
          `${result.holdings.length} holding(s)` +
          (result.offers ? `, ${result.offers.length} offer(s)` : "")
      );
    } catch (err) {
      console.error(`${scraper.displayName} scraper failed:`, err);
    }
  }

  // Output
  if (!fs.existsSync(globalConfig.outputDir)) {
    fs.mkdirSync(globalConfig.outputDir, { recursive: true });
  }

  // Attach optional data
  if (cashInterest) combined.cashInterest = cashInterest;
  if (stockLending) combined.stockLending = stockLending;
  if (allOffers) combined.offers = allOffers;
  if (amexOffers) combined.amexOffers = amexOffers;
  if (amexCardDetails) combined.amexCardDetails = amexCardDetails;
  if (capitalOneCards) combined.capitalOneCards = capitalOneCards;
  if (capitalOneOffers) combined.capitalOneOffers = capitalOneOffers;
  if (capitalOneRewards) combined.capitalOneRewards = capitalOneRewards;

  const outputFile = path.join(
    globalConfig.outputDir,
    `scrape-${new Date().toISOString().split("T")[0]}.json`
  );
  fs.writeFileSync(outputFile, JSON.stringify(combined, null, 2));
  console.log(`\nResults written to: ${outputFile}`);

  // Summary
  console.log("\n=== Account Summary ===");
  for (const acct of combined.accounts) {
    console.log(
      `  [${acct.institution}] ${acct.name} (${acct.type}): $${acct.currentBalance.toFixed(2)}`
    );
  }
  if (combined.holdings.length > 0) {
    const totalHoldings = combined.holdings.reduce(
      (s, h) => s + h.currentValue,
      0
    );
    console.log(
      `\n${combined.holdings.length} holding(s) worth $${totalHoldings.toFixed(2)}`
    );
  }
  console.log(`${combined.transactions.length} transaction(s) scraped.`);

  // Copy data for web dashboard
  const webPublicDir = path.join(projectRoot, "web", "public");
  if (!fs.existsSync(webPublicDir)) {
    fs.mkdirSync(webPublicDir, { recursive: true });
  }
  fs.copyFileSync(outputFile, path.join(webPublicDir, "data.json"));

  // Launch dashboard
  if (process.env.NO_DASHBOARD !== "true") {
    console.log("\nLaunching dashboard at http://localhost:5173 ...\n");
    const vite = spawn("npx", ["vite", "--config", "web/vite.config.ts"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    vite.on("error", (err) =>
      console.error("Failed to launch dashboard:", err)
    );

    process.on("SIGINT", () => {
      vite.kill();
      process.exit(0);
    });
  }
}

main();
