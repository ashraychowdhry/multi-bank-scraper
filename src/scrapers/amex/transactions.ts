import * as fs from "node:fs";
import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { parseBalance, normalizeDate } from "../utils.js";
import { afterNavigation } from "../popup-guard.js";
import { parseAmexCSV } from "./csv.js";

const ACTIVITY_URL = "https://global.americanexpress.com/activity/recent";

export async function scrapeTransactions(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  console.log("[amex] Scraping transactions...");

  await page.goto(ACTIVITY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await afterNavigation(page, { scraperName: "amex" });
  await page.waitForTimeout(4000);

  // Try CSV download first (most complete data, includes categories)
  const csvTransactions = await downloadTransactionsCSV(page, accountName);
  if (csvTransactions.length > 0) {
    console.log(
      `[amex]   ${csvTransactions.length} transaction(s) from CSV.`
    );

    // Also try to get pending transactions from the page
    const pendingTxns = await scrapePendingTransactions(page, accountName);
    if (pendingTxns.length > 0) {
      console.log(`[amex]   ${pendingTxns.length} pending transaction(s).`);
    }

    return [...pendingTxns, ...csvTransactions];
  }

  // Fallback: scrape the transaction table from the page
  console.log("[amex]   CSV not available, scraping transaction table...");
  return await scrapeTransactionTable(page, accountName);
}

async function downloadTransactionsCSV(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  try {
    // Click the download button: data-testid="feed-download-button"
    const downloadBtn = page.locator(
      '[data-testid="feed-download-button"]'
    );
    if (
      !(await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      console.log("[amex]   No download button found.");
      return [];
    }

    console.log("[amex]   Clicking download button...");
    await downloadBtn.click();
    await page.waitForTimeout(2000);

    // A download modal appears with radio buttons for format (CSV, QFX, etc).
    // The radio input is intercepted by its <label>, so click with force: true.
    const csvRadio = page.locator(
      'input[id*="csv"], input[value="csv"]'
    ).first();
    if (await csvRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("[amex]   Selecting CSV format...");
      await csvRadio.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Click the modal's download/confirm button.
    // The modal has its own "Download" button distinct from feed-download-button.
    // Use a more specific selector to avoid matching the original button.
    const confirmBtn = page.locator(
      '[data-testid*="download-body"] button:has-text("Download"), ' +
      '[class*="modal"] button:has-text("Download"), ' +
      '[role="dialog"] button:has-text("Download")'
    ).first();

    const hasConfirmBtn = await confirmBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!hasConfirmBtn) {
      // Try a broader approach — find the second "Download" button on the page
      const allDownloadBtns = await page
        .locator('button:has-text("Download")')
        .all();
      console.log(
        `[amex]   Found ${allDownloadBtns.length} download button(s) total`
      );

      if (allDownloadBtns.length < 2) {
        console.log("[amex]   No confirm button in download modal.");
        // Try clicking escape to close modal
        await page.keyboard.press("Escape");
        return [];
      }

      // The second download button is the confirm button in the modal
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10000 }),
        allDownloadBtns[1].click(),
      ]);

      const filePath = await download.path();
      if (!filePath) return [];
      const csvContent = fs.readFileSync(filePath, "utf-8");
      console.log(`[amex]   Downloaded CSV (${csvContent.length} bytes).`);
      return parseAmexCSV(csvContent, accountName);
    }

    console.log("[amex]   Clicking confirm download...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      confirmBtn.click(),
    ]);

    const filePath = await download.path();
    if (!filePath) return [];

    const csvContent = fs.readFileSync(filePath, "utf-8");
    console.log(`[amex]   Downloaded CSV (${csvContent.length} bytes).`);
    return parseAmexCSV(csvContent, accountName);
  } catch (err) {
    console.log(`[amex]   CSV download failed: ${err}`);
    // Close modal if it's open
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    return [];
  }
}

async function scrapePendingTransactions(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];

  try {
    // Check pending charges amount from the balances container
    const pendingAmount = await page
      .locator(
        '[data-testid="myca-activity-balances-vitals_pendingBalances"] [data-testid="formatted-number"]'
      )
      .first()
      .textContent()
      .then((t) => t?.trim() || "$0.00")
      .catch(() => "$0.00");

    if (pendingAmount === "$0.00") {
      return [];
    }

    // Extract pending rows in a single evaluate call
    const pendingRows = await page.evaluate(() => {
      const rows = document.querySelectorAll(
        '[data-testid="transaction-table-row"]'
      );
      return Array.from(rows)
        .filter((row) => {
          const status =
            row
              .querySelector('[data-testid="transaction-status"]')
              ?.textContent?.trim()
              .toLowerCase() || "";
          return status === "pending";
        })
        .map((row) => ({
          date:
            row
              .querySelector('[data-testid="transaction-date"]')
              ?.textContent?.trim() || "",
          description:
            row
              .querySelector('[data-testid="transaction-description"]')
              ?.textContent?.trim()
              .replace(/\s{2,}/g, " ") || "",
          amount:
            row
              .querySelector('[data-testid="transaction-amount"]')
              ?.textContent?.trim() || "",
        }));
    });

    for (const r of pendingRows) {
      if (!r.date || !r.amount) continue;

      const dateStr = r.date.match(/\d{4}/)
        ? r.date
        : `${r.date}, ${new Date().getFullYear()}`;

      const rawAmount = parseBalance(r.amount);
      const amount = r.amount.startsWith("-")
        ? Math.abs(rawAmount)
        : -rawAmount;

      transactions.push({
        date: normalizeDate(dateStr),
        description: r.description,
        amount,
        isPending: true,
        accountName,
      });
    }
  } catch {
    // Pending section may not exist
  }

  return transactions;
}

async function scrapeTransactionTable(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];

  try {
    // Wait for the transaction table to load
    // data-testid="myca-activity-feed/TransactionTable/transactions"
    await page
      .locator('[data-testid="myca-activity-feed/TransactionTable/transactions"]')
      .waitFor({ timeout: 10000 });

    // Get all transaction rows: data-testid="transaction-table-row"
    const rows = await page
      .locator('[data-testid="transaction-table-row"]')
      .all();

    console.log(`[amex]   Found ${rows.length} transaction row(s)`);

    // Extract all transaction data in a single evaluate call for performance
    const rowData = await page.evaluate(() => {
      const rows = document.querySelectorAll(
        '[data-testid="transaction-table-row"]'
      );
      return Array.from(rows).map((row) => ({
        date:
          row
            .querySelector('[data-testid="transaction-date"]')
            ?.textContent?.trim() || "",
        status:
          row
            .querySelector('[data-testid="transaction-status"]')
            ?.textContent?.trim() || "",
        description:
          row
            .querySelector('[data-testid="transaction-description"]')
            ?.textContent?.trim()
            .replace(/\s{2,}/g, " ") || "",
        amount:
          row
            .querySelector('[data-testid="transaction-amount"]')
            ?.textContent?.trim() || "",
      }));
    });

    for (const r of rowData) {
      if (!r.date || !r.amount) continue;

      // Date is like "Feb 23" — append current year
      const dateStr = r.date.match(/\d{4}/)
        ? r.date
        : `${r.date}, ${new Date().getFullYear()}`;

      const rawAmount = parseBalance(r.amount);
      // In the Amex activity page DOM:
      // - Credits/payments show as "-$300.00" (green, class dls-green)
      // - Charges show as "$5.99" (normal)
      // Our convention: charges = negative (money out), credits = positive (money in)
      const amount = r.amount.startsWith("-")
        ? Math.abs(rawAmount)
        : -rawAmount;

      const isPending = r.status.toLowerCase() === "pending";

      transactions.push({
        date: normalizeDate(dateStr),
        description: r.description,
        amount,
        category: r.status === "Credit" ? "Credit" : undefined,
        isPending,
        accountName,
      });
    }
  } catch (err) {
    console.warn("[amex]   Error scraping transaction table:", err);
  }

  console.log(`[amex]   Parsed ${transactions.length} transaction(s).`);
  return transactions;
}
