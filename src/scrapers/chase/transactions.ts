import * as fs from "node:fs";
import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { parseBalance, normalizeDate } from "../utils.js";
import { DASHBOARD_URL } from "./login.js";
import type { ChaseAccountData } from "./accounts.js";
import { parseChaseCSV } from "./csv.js";

export async function scrapeTransactions(
  page: Page,
  accounts: ChaseAccountData[]
): Promise<Omit<Transaction, "institution">[]> {
  const allTransactions: Omit<Transaction, "institution">[] = [];

  for (const account of accounts) {
    try {
      console.log(`[chase] Scraping transactions for: ${account.name}`);

      const nameBtn = page
        .locator(
          `[data-testid="accounts-name-link"] mds-button[text*="${account.accountNumber}"]`
        )
        .first();

      if (!(await nameBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
        console.warn(`  Could not find link for ${account.name}, skipping.`);
        continue;
      }

      const urlBefore = page.url();
      await nameBtn.evaluate((el) => {
        const inner = el.shadowRoot?.querySelector("button, a") || el;
        (inner as HTMLElement).click();
      });

      await page
        .waitForURL((url) => url.toString() !== urlBefore, { timeout: 10000 })
        .catch(() => {});
      console.log(`  Navigated to: ${page.url()}`);

      await page
        .waitForSelector('tr[id*="ACTIVITY-dataTableId-row-"]', {
          timeout: 15000,
        })
        .catch(() => console.log("  Transaction table not found."));
      await page.waitForTimeout(2000);

      // Try CSV download first (most complete data)
      const csvTxns = await downloadTransactionsCSV(page, account.name);
      if (csvTxns.length > 0) {
        console.log(`  ${csvTxns.length} transaction(s) from CSV.`);
        allTransactions.push(...csvTxns);
      } else {
        // Fall back to scraping the detail page transaction table
        console.log("  CSV not available, scraping transaction table...");
        const tableTxns = await scrapeDetailTransactions(page, account.name);
        allTransactions.push(...tableTxns);
      }
    } catch (err) {
      console.warn(`  Error scraping ${account.name}:`, err);
    }

    // Always return to dashboard for next account
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="accountTile"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  return allTransactions;
}

async function scrapeDetailTransactions(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];

  const rows = await page.$$('tr[id*="ACTIVITY-dataTableId-row-"]');
  console.log(`  Found ${rows.length} transaction row(s) on detail page.`);

  for (const row of rows) {
    try {
      const data = await row.evaluate((el) => {
        const th = el.querySelector("th");
        const tds = el.querySelectorAll("td");
        if (tds.length < 2) return null;

        const dateText = th?.textContent?.trim() || "";

        const descSpan = tds[0]?.querySelector(
          '[data-testid="rich-text-accessible-text"]'
        );
        const descText =
          descSpan?.textContent?.trim() || tds[0]?.textContent?.trim() || "";

        let amountRaw = "";
        for (let i = 1; i < tds.length; i++) {
          const cellText = tds[i]?.textContent?.trim() || "";
          const match = cellText.match(/[\u2212-]?\$[\d,]+\.\d{2}/);
          if (match) {
            amountRaw = match[0];
            break;
          }
        }

        return {
          date: dateText,
          description: descText,
          amountRaw,
          isPending: dateText.toLowerCase().includes("pending"),
        };
      });

      if (data?.date && data.amountRaw) {
        transactions.push({
          date: normalizeDate(data.date),
          description: data.description,
          amount: parseBalance(data.amountRaw),
          isPending: data.isPending,
          accountName,
          category: undefined,
        });
      }
    } catch {
      // Skip unparseable rows
    }
  }

  console.log(`  Parsed ${transactions.length} transaction(s).`);
  return transactions;
}

async function downloadTransactionsCSV(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  try {
    const dlBtn = page.locator(
      '[data-testid="quick-action-download-activity-tooltip-button"]'
    );

    if (!(await dlBtn.isVisible({ timeout: 3000 }))) {
      return [];
    }

    await dlBtn.click();
    await page.waitForTimeout(2000);

    const downloadMdsBtn = page.locator('mds-button[text="Download"]').first();
    if (!(await downloadMdsBtn.isVisible({ timeout: 3000 }))) {
      console.log("  Download button not found in modal.");
      return [];
    }

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      downloadMdsBtn.evaluate((el) => {
        const inner = el.shadowRoot?.querySelector("button") || el;
        (inner as HTMLElement).click();
      }),
    ]);

    const filePath = await download.path();
    if (!filePath) return [];

    const csvContent = fs.readFileSync(filePath, "utf-8");
    console.log(`  Downloaded CSV (${csvContent.length} bytes).`);
    return parseChaseCSV(csvContent, accountName);
  } catch (err) {
    console.log(`  CSV download failed: ${err}`);
    return [];
  }
}
