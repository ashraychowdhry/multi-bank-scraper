import type { Page } from "playwright";
import type { AccountType } from "../../types.js";
import { parseBalance } from "../utils.js";
import { DASHBOARD_URL } from "./login.js";

// Internal type without institution field (added by ChaseScraper.scrape)
export interface ChaseAccountData {
  name: string;
  type: AccountType;
  currentBalance: number;
  accountNumber: string;
}

export async function scrapeAccounts(page: Page): Promise<ChaseAccountData[]> {
  console.log("[chase] Scraping accounts from dashboard...");

  if (!page.url().includes("dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  }

  await page.waitForSelector('[data-testid="accountTile"]', {
    timeout: 15000,
  });
  await page.waitForTimeout(1500);

  const accounts: ChaseAccountData[] = [];
  const tiles = await page.$$('[data-testid="accountTile"]');
  console.log(`[chase] Found ${tiles.length} account tile(s).`);

  for (const tile of tiles) {
    try {
      const data = await tile.evaluate((el) => {
        const text = el.textContent || "";

        const nameBtn = el.querySelector(
          '[data-testid="accounts-name-link"] mds-button'
        );
        const name = nameBtn?.getAttribute("text") || "";

        const acctMatch = name.match(/\.{2,3}(\d{4})/);

        const dollarMatch = text.match(/\$[\d,]+\.\d{2}/);
        const balance = dollarMatch ? dollarMatch[0] : "";

        return { name, accountNumber: acctMatch?.[1] || "", balance };
      });

      console.log(
        `  ${data.name || "(unnamed)"} — ${data.balance || "no balance"}`
      );

      if (data.balance) {
        accounts.push({
          name: data.name || `Account ...${data.accountNumber}`,
          type: inferAccountType(data.name),
          currentBalance: parseBalance(data.balance),
          accountNumber: data.accountNumber,
        });
      }
    } catch (err) {
      console.warn("[chase] Error parsing account tile:", err);
    }
  }

  console.log(`[chase] Parsed ${accounts.length} account(s).`);
  return accounts;
}

function inferAccountType(name: string): AccountType {
  const lower = name.toLowerCase();
  if (lower.includes("checking") || lower.includes("college")) return "checking";
  if (lower.includes("saving")) return "savings";
  if (
    lower.includes("credit") ||
    lower.includes("card") ||
    lower.includes("sapphire") ||
    lower.includes("freedom") ||
    lower.includes("slate") ||
    lower.includes("ink")
  )
    return "credit";
  if (
    lower.includes("invest") ||
    lower.includes("you invest") ||
    lower.includes("brokerage")
  )
    return "investment";
  return "other";
}
