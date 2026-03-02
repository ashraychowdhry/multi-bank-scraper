import * as fs from "node:fs";
import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { parseBalance, normalizeDate } from "../utils.js";
import { afterNavigation } from "../popup-guard.js";
import { parseAmexCSV } from "./csv.js";

const ACTIVITY_URL = "https://global.americanexpress.com/activity/recent";
const STATEMENTS_URL =
  "https://global.americanexpress.com/activity?inav=myca_statements";

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

  const allTransactions: Omit<Transaction, "institution">[] = [];

  // Step 1: Scrape pending transactions first (they only appear on "recent" view)
  const pendingTxns = await scrapePendingTransactions(page, accountName);
  if (pendingTxns.length > 0) {
    console.log(`[amex]   ${pendingTxns.length} pending transaction(s).`);
    allTransactions.push(...pendingTxns);
  }

  // Step 2: Navigate to Statements & Activity page for historical data
  // The /activity/recent page has date picker badges in a collapsed panel;
  // the full statements page (/activity?inav=myca_statements) has them accessible
  try {
    console.log("[amex]   Navigating to Statements & Activity page...");
    await page.goto(STATEMENTS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await afterNavigation(page, { scraperName: "amex" });
    await page.waitForTimeout(5000);
  } catch (err) {
    console.log(`[amex]   Could not navigate to statements page: ${err}`);
  }

  // Step 3: Click "View Your YYYY Transactions" link for prior year data
  // The Statements & Activity page shows a tax season banner with this link
  let gotHistorical = false;
  try {
    const viewYearLink = page
      .locator(
        '[data-testid="myca-activity-tax-season-banner/view-year-transactions"]'
      )
      .first();
    if (await viewYearLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      const linkText =
        (await viewYearLink.textContent().catch(() => "")) || "";
      console.log(`[amex]   Clicking "${linkText.trim()}"...`);

      // Extract the year from link text (e.g. "View Your 2025 Transactions")
      const yearMatch = linkText.match(/(\d{4})/);
      const priorYear = yearMatch ? parseInt(yearMatch[1]) : undefined;

      await viewYearLink.click();
      await page.waitForTimeout(5000);

      // Scrape the prior year's transactions, passing the year for correct date parsing
      const txns = await scrapeCurrentView(page, accountName, priorYear);
      if (txns.length > 0) {
        console.log(
          `[amex]   ${txns.length} transaction(s) from ${priorYear || "prior year"}`
        );
        allTransactions.push(...txns);
        gotHistorical = true;
      }
    }
  } catch (err) {
    console.log(`[amex]   Error loading prior year: ${err}`);
  }

  // Step 4: Navigate back to current activity for current year transactions
  if (gotHistorical) {
    try {
      console.log("[amex]   Navigating back to recent activity...");
      await page.goto(ACTIVITY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await afterNavigation(page, { scraperName: "amex" });
      await page.waitForTimeout(4000);

      const recentTxns = await scrapeCurrentView(page, accountName);
      if (recentTxns.length > 0) {
        console.log(
          `[amex]   ${recentTxns.length} transaction(s) from recent activity`
        );
        allTransactions.push(...recentTxns);
      }
    } catch (err) {
      console.log(`[amex]   Error loading recent activity: ${err}`);
    }
  }

  // Step 5: If no historical data, try date range badges as fallback
  if (!gotHistorical) {
    gotHistorical = await scrapeWithDateBadges(
      page,
      accountName,
      allTransactions
    );
  }

  // Step 6: If still nothing, scrape current view
  if (allTransactions.filter((t) => !t.isPending).length === 0) {
    console.log("[amex]   No historical data found, scraping current view...");
    const csv = await downloadTransactionsCSV(page, accountName);
    if (csv.length > 0) {
      allTransactions.push(...csv);
    } else {
      const domTxns = await scrapeTransactionTable(page, accountName);
      allTransactions.push(...domTxns);
    }
  }

  // Deduplicate by date+description+amount
  const seen = new Set<string>();
  const deduped = allTransactions.filter((t) => {
    const key = `${t.date}|${t.description}|${t.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dates = deduped
    .filter((t) => !t.isPending)
    .map((t) => t.date)
    .sort();
  if (dates.length > 0) {
    console.log(
      `[amex]   Total: ${deduped.length} unique transaction(s), ` +
        `${dates[0]} to ${dates[dates.length - 1]}`
    );
  }
  return deduped;
}

/**
 * Try clicking date range badges to get historical transactions.
 * Returns true if any historical data was scraped.
 */
async function scrapeWithDateBadges(
  page: Page,
  accountName: string,
  allTransactions: Omit<Transaction, "institution">[]
): Promise<boolean> {
  let gotHistorical = false;

  // Try year badges first (broadest coverage)
  const yearBadges = [
    { testId: "dateRangePicker.yearBadge", label: "prior year" },
    {
      testId: "dateRangePicker.currentYearBadge",
      label: "current year to date",
    },
  ];

  for (const { testId, label } of yearBadges) {
    try {
      const badge = page.locator(`[data-testid="${testId}"]`).first();
      // Scroll into view first — badges may be below the fold
      await badge
        .scrollIntoViewIfNeeded({ timeout: 2000 })
        .catch(() => {});

      const visible = await badge
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (visible) {
        const badgeText = await badge.textContent().catch(() => "");
        console.log(
          `[amex]   Clicking date range: "${badgeText?.trim()}" (${label})`
        );
        await badge.click();
      } else {
        // Badge exists in DOM but not visible — try force click
        const count = await badge.count();
        if (count > 0) {
          console.log(
            `[amex]   Badge ${testId} not visible, trying force click...`
          );
          await badge.click({ force: true, timeout: 3000 });
        } else {
          continue;
        }
      }

      await page.waitForTimeout(5000);

      // Try CSV download, then DOM scraping
      const txns = await scrapeCurrentView(page, accountName);
      if (txns.length > 0) {
        console.log(`[amex]   ${txns.length} transaction(s) (${label})`);
        allTransactions.push(...txns);
        gotHistorical = true;
      }
    } catch (err) {
      console.log(`[amex]   Error with ${testId}: ${err}`);
    }
  }

  // If year badges didn't work, try individual billing period badges
  if (!gotHistorical) {
    try {
      const billingBadges = await page
        .locator('[data-testid="dateRangePicker.billingPeriodBadge"]')
        .all();
      console.log(
        `[amex]   Found ${billingBadges.length} billing period badge(s)`
      );

      for (let i = 0; i < billingBadges.length; i++) {
        try {
          await billingBadges[i]
            .scrollIntoViewIfNeeded({ timeout: 1000 })
            .catch(() => {});
          const text = await billingBadges[i].textContent().catch(() => "");
          console.log(`[amex]   Clicking billing period: "${text?.trim()}"`);

          const visible = await billingBadges[i]
            .isVisible({ timeout: 1000 })
            .catch(() => false);
          if (visible) {
            await billingBadges[i].click();
          } else {
            await billingBadges[i].click({ force: true, timeout: 3000 });
          }
          await page.waitForTimeout(4000);

          const txns = await scrapeCurrentView(page, accountName);
          if (txns.length > 0) {
            console.log(`[amex]     ${txns.length} transaction(s)`);
            allTransactions.push(...txns);
            gotHistorical = true;
          }
        } catch (err) {
          console.log(`[amex]   Error with billing badge ${i}: ${err}`);
        }
      }
    } catch (err) {
      console.log(`[amex]   Error finding billing badges: ${err}`);
    }
  }

  return gotHistorical;
}

/**
 * Try CSV download first, fall back to DOM scraping.
 * @param defaultYear — year to use for dates that don't include one (e.g. 2025 for prior year view)
 */
async function scrapeCurrentView(
  page: Page,
  accountName: string,
  defaultYear?: number
): Promise<Omit<Transaction, "institution">[]> {
  const csv = await downloadTransactionsCSV(page, accountName);
  if (csv.length > 0) return csv;
  return scrapeTransactionTable(page, accountName, defaultYear);
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
  accountName: string,
  defaultYear?: number
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];
  const yearToUse = defaultYear || new Date().getFullYear();

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

      // Date is like "Feb 23" — append the appropriate year
      const dateStr = r.date.match(/\d{4}/)
        ? r.date
        : `${r.date}, ${yearToUse}`;

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
