import * as fs from "node:fs";
import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { parseBalance, normalizeDate } from "../utils.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";
import { parseCapitalOneCSV } from "./csv.js";
import type { CapitalOneAccountData } from "./accounts.js";
import { DASHBOARD_URL } from "./login.js";

export async function scrapeTransactions(
  page: Page,
  accounts: CapitalOneAccountData[]
): Promise<Omit<Transaction, "institution">[]> {
  console.log("[capitalone] Scraping transactions...");

  const allTransactions: Omit<Transaction, "institution">[] = [];

  for (const account of accounts) {
    try {
      console.log(
        `[capitalone]   Scraping transactions for "${account.name}"...`
      );

      // Transactions are inline on the card detail page — navigate there
      if (!page.url().includes("/Card/")) {
        await page.goto(DASHBOARD_URL, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page, { scraperName: "capitalone" });
      }

      if (!account.viewAccountTestId) {
        console.log(
          `[capitalone]     No account ID for "${account.name}", skipping`
        );
        continue;
      }

      // Navigate to card detail page (transactions are inline there)
      if (account.actionBtnText === "View Account") {
        const btn = page.locator(
          `button[data-testid="${account.viewAccountTestId}"]`
        );
        if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) {
          console.log(
            `[capitalone]     "View Account" button not visible for "${account.name}"`
          );
          continue;
        }
        await btn.click();
      } else {
        // Direct URL navigation — extract card ID from data-testid
        const cardId = account.viewAccountTestId.replace(/^summary-/, "");
        const cardUrl = `https://myaccounts.capitalone.com/Card/${encodeURIComponent(cardId)}`;
        console.log(
          `[capitalone]     Navigating directly to ${account.name} detail page...`
        );
        await page.goto(cardUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      }
      await page.waitForTimeout(5000);
      await afterNavigation(page, { scraperName: "capitalone" });

      // Ensure "All Transactions" tab is active (not "Payment Activity")
      const allTxnTab = page
        .locator('button:has-text("All Transactions")')
        .first();
      if (
        await allTxnTab.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        const isActive = await allTxnTab.evaluate((el) =>
          el.classList.contains("c1-ease-button--disabled")
        );
        if (!isActive) {
          await allTxnTab.click();
          await page.waitForTimeout(2000);
        }
      }

      // Try CSV download first (most reliable)
      const csvTxns = await downloadTransactionsCSV(page, account.name);
      if (csvTxns.length > 0) {
        console.log(
          `[capitalone]     ${csvTxns.length} transaction(s) from CSV`
        );
        allTransactions.push(...csvTxns);
      } else {
        // Fallback: scrape inline transaction sections
        const inlineTxns = await scrapeInlineTransactions(
          page,
          account.name
        );
        console.log(
          `[capitalone]     ${inlineTxns.length} posted transaction(s) from inline table`
        );
        allTransactions.push(...inlineTxns);
      }

      // Always scrape pending transactions (not in CSV)
      const pendingTxns = await scrapePendingTransactions(
        page,
        account.name
      );
      if (pendingTxns.length > 0) {
        console.log(
          `[capitalone]     ${pendingTxns.length} pending transaction(s)`
        );
        allTransactions.push(...pendingTxns);
      }

      // Navigate back to dashboard for next card
      await page.goto(DASHBOARD_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(3000);
      await dismissPopups(page, { scraperName: "capitalone" });
    } catch (err) {
      console.warn(
        `[capitalone]   Error scraping transactions for "${account.name}":`,
        err
      );
    }
  }

  console.log(`[capitalone]   ${allTransactions.length} total transaction(s)`);
  return allTransactions;
}

async function downloadTransactionsCSV(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  try {
    // Scroll down to find the "Download Transactions" button in the statement section
    // (the extensibility bar link doesn't reliably open the dialog)
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1000);

    const downloadBtn = page
      .locator('button:has-text("Download Transactions")')
      .first();
    if (
      !(await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      console.log("[capitalone]     No Download Transactions button found");
      return [];
    }

    console.log("[capitalone]     Opening Download Transactions dialog...");
    await downloadBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await downloadBtn.click();
    await page.waitForTimeout(2000);

    // Wait for the dialog to appear
    const dialog = page.locator('[role="dialog"]').first();
    if (
      !(await dialog.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      console.log("[capitalone]     Download dialog did not open");
      return [];
    }

    // Step 1: Select File Type = CSV
    // Capital One uses custom c1-ease-select components; click the first one to open dropdown
    const fileTypeDropdown = dialog.locator("c1-ease-select").first();
    if (
      await fileTypeDropdown.isVisible({ timeout: 2000 }).catch(() => false)
    ) {
      console.log("[capitalone]     Selecting File Type: CSV");
      await fileTypeDropdown.click();
      await page.waitForTimeout(1000);

      // Options appear in a CDK overlay pane
      const csvOption = page
        .locator(
          '.cdk-overlay-pane [role="option"]:has-text("CSV")'
        )
        .first();
      if (
        await csvOption.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await csvOption.click();
        await page.waitForTimeout(1000);
      } else {
        console.log("[capitalone]     CSV option not found in dropdown");
        await page.keyboard.press("Escape").catch(() => {});
        await closeDialog(page);
        return [];
      }
    }

    // Step 2: Select Time Period = "Custom Date Range" for 1 year of data
    const timePeriodDropdown = dialog.locator("c1-ease-select").nth(1);
    if (
      await timePeriodDropdown.isVisible({ timeout: 2000 }).catch(() => false)
    ) {
      console.log('[capitalone]     Selecting Time Period: Custom Date Range');
      await timePeriodDropdown.click();
      await page.waitForTimeout(1000);

      const customOption = page
        .locator(
          '.cdk-overlay-pane [role="option"]:has-text("Custom Date Range")'
        )
        .first();
      if (
        await customOption.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await customOption.click();
        await page.waitForTimeout(1500);
      } else {
        // Fall back to "By Statement" if Custom Date Range not available
        console.log("[capitalone]     Custom Date Range not found, falling back to By Statement");
        const byStmtOption = page
          .locator(
            '.cdk-overlay-pane [role="option"]:has-text("By Statement")'
          )
          .first();
        if (
          await byStmtOption.isVisible({ timeout: 1000 }).catch(() => false)
        ) {
          await byStmtOption.click();
          await page.waitForTimeout(1000);
        } else {
          const firstOption = page
            .locator('.cdk-overlay-pane [role="option"]')
            .first();
          if (
            await firstOption.isVisible({ timeout: 1000 }).catch(() => false)
          ) {
            await firstOption.click();
            await page.waitForTimeout(1000);
          }
        }
      }
    }

    // Step 3: Fill Custom Date Range — start date (1 year ago) and end date (today)
    const dateRangeFilled = await fillCustomDateRange(page, dialog);
    if (!dateRangeFilled) {
      console.log("[capitalone]     Custom date range form not found, proceeding with defaults");
    }

    // Step 4: Click Export
    const exportBtn = dialog
      .locator('button:has-text("Export")')
      .first();
    if (
      !(await exportBtn.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      console.log("[capitalone]     Export button not found");
      await closeDialog(page);
      return [];
    }

    const isDisabled = await exportBtn.evaluate((el) =>
      el.classList.contains("c1-ease-button--disabled")
    );
    if (isDisabled) {
      console.log("[capitalone]     Export button is disabled");
      await closeDialog(page);
      return [];
    }

    console.log("[capitalone]     Clicking Export...");
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        exportBtn.click(),
      ]);
      const filePath = await download.path();
      if (filePath) {
        const csvContent = fs.readFileSync(filePath, "utf-8");
        console.log(
          `[capitalone]     Downloaded CSV (${csvContent.length} bytes)`
        );
        return parseCapitalOneCSV(csvContent, accountName);
      }
    } catch {
      console.log("[capitalone]     CSV download event timed out");
    }

    await closeDialog(page);
    return [];
  } catch (err) {
    console.log(`[capitalone]     CSV download failed: ${err}`);
    await closeDialog(page);
    return [];
  }
}

/**
 * Fill the Custom Date Range form with start = 1 year ago, end = today.
 *
 * Capital One uses Angular c1-ease-date-input components.
 * Playwright's .fill() doesn't trigger Angular's change detection,
 * so we must: clear → type char-by-char → Tab out to trigger validation.
 */
async function fillCustomDateRange(
  page: Page,
  dialog: ReturnType<Page["locator"]>
): Promise<boolean> {
  try {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const formatDate = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

    const startDateStr = formatDate(oneYearAgo);
    const endDateStr = formatDate(today);

    console.log(
      `[capitalone]     Setting date range: ${startDateStr} – ${endDateStr}`
    );

    // Find the date inputs — try multiple selector strategies
    let inputs: ReturnType<Page["locator"]> | null = null;
    let count = 0;

    // Strategy 1: c1-ease-date-input custom components (most likely)
    const dateComponents = dialog.locator("c1-ease-date-input input");
    count = await dateComponents.count();
    if (count >= 2) {
      inputs = dateComponents;
      console.log(`[capitalone]     Found ${count} c1-ease-date-input inputs`);
    }

    // Strategy 2: generic text/date inputs in the dialog
    if (!inputs) {
      const textInputs = dialog.locator('input[type="text"], input[type="date"]');
      count = await textInputs.count();
      if (count >= 2) {
        inputs = textInputs;
        console.log(`[capitalone]     Found ${count} text/date inputs`);
      }
    }

    // Strategy 3: placeholder-based
    if (!inputs) {
      const phInputs = dialog.locator(
        'input[placeholder*="MM"], input[placeholder*="date" i], input[aria-label*="date" i]'
      );
      count = await phInputs.count();
      if (count >= 2) {
        inputs = phInputs;
        console.log(`[capitalone]     Found ${count} placeholder-based inputs`);
      }
    }

    if (!inputs || count < 2) {
      console.log(`[capitalone]     No date inputs found (checked 3 strategies)`);
      return false;
    }

    // Fill each input: click → select all → delete → type → Tab
    for (let i = 0; i < 2; i++) {
      const input = inputs.nth(i);
      const dateStr = i === 0 ? startDateStr : endDateStr;
      const label = i === 0 ? "start" : "end";

      await input.click();
      await page.waitForTimeout(200);

      // Select all and delete existing content
      await page.keyboard.press("Meta+a");
      await page.waitForTimeout(100);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(100);

      // Type date character by character to trigger Angular's input events
      await page.keyboard.type(dateStr, { delay: 50 });
      await page.waitForTimeout(300);

      // Tab out to trigger blur/validation
      await page.keyboard.press("Tab");
      await page.waitForTimeout(500);

      console.log(`[capitalone]     ${label} date: typed "${dateStr}"`);
    }

    // Wait for Angular validation to settle
    await page.waitForTimeout(1000);

    return true;
  } catch (err) {
    console.log(`[capitalone]     Error filling date range: ${err}`);
    return false;
  }
}

async function closeDialog(page: Page): Promise<void> {
  const closeBtn = page
    .locator('[role="dialog"] button[aria-label="Close Dialog" i]')
    .first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await page.waitForTimeout(500);
}

/**
 * Scrape posted transactions from the inline table on the card detail page.
 *
 * Sections on the page:
 * - "Posted Transactions Since Your Last Statement"
 * - "Statement Ending Feb 21, 2026" (past statements)
 *
 * Each section has c1-ease-table__body containers with transaction rows.
 * Each row has:
 * - c1-ease-txns-description__details (merchant name, role="button")
 * - c1-ease-txns-description__category (category)
 * - Amount in a span (negative amounts have class c1-ease-card-transactions-view-table__amount--currency)
 */
async function scrapeInlineTransactions(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];

  try {
    // Wait for transaction content to be visible
    await page
      .waitForSelector(".c1-ease-card-transactions-view__table", {
        timeout: 8000,
      })
      .catch(() => null);

    const rowData = await page.evaluate(() => {
      const results: {
        description: string;
        category: string;
        amount: string;
        sectionLabel: string;
      }[] = [];

      // Find all transaction view table sections
      const sections = document.querySelectorAll(
        ".c1-ease-card-transactions-view__table"
      );

      for (const section of sections) {
        const headerEl = section.querySelector(
          ".c1-ease-card-transactions-view__table--headersection-title"
        );
        const headerText = headerEl?.textContent?.trim() || "";

        // Skip pending (handled separately), scheduled payments, autopay
        if (
          headerText.includes("Pending") ||
          headerText.includes("Scheduled")
        )
          continue;

        // Only process "Posted Transactions" and "Statement Ending" sections
        if (
          !headerText.includes("Posted") &&
          !headerText.includes("Statement")
        )
          continue;

        const bodies = section.querySelectorAll(".c1-ease-table__body");
        for (const body of bodies) {
          // Skip autopay/settings bodies
          if (
            body.textContent?.includes("AUTOPAY SETTINGS") ||
            body.textContent?.includes("Manage AutoPay")
          )
            continue;

          // Each row in the table body is a direct child (or grandchild)
          // that contains a c1-ease-txns-description element
          const descEls = body.querySelectorAll(
            ".c1-ease-txns-description"
          );

          for (const descEl of descEls) {
            const detailsEl = descEl.querySelector(
              ".c1-ease-txns-description__details"
            );

            const catEl = descEl.querySelector(
              ".c1-ease-txns-description__category"
            );
            const category = catEl?.textContent?.trim() || "";

            // Get merchant name — detailsEl.textContent includes nested
            // category text, so strip the category suffix if present
            let merchant =
              detailsEl?.textContent
                ?.trim()
                .replace(/\s{2,}/g, " ") || "";
            if (category && merchant.endsWith(category)) {
              merchant = merchant.slice(0, -category.length).trim();
            }

            // Find amount: walk up from description to find the containing row,
            // then look for amount spans
            let amount = "";
            let el: Element | null = descEl;
            // Walk up until we find a sibling/parent with dollar amounts
            for (let i = 0; i < 5; i++) {
              el = el?.parentElement || null;
              if (!el || el.classList.contains("c1-ease-table__body"))
                break;

              // Check for negative amount span
              const negSpan = el.querySelector(
                ".c1-ease-card-transactions-view-table__amount--currency"
              );
              if (negSpan) {
                amount = negSpan.textContent?.trim() || "";
                break;
              }

              // Check for positive amount in spans (outside description)
              const spans = el.querySelectorAll("span");
              for (const span of spans) {
                if (span.closest(".c1-ease-txns-description")) continue;
                const text = span.textContent?.trim() || "";
                if (text.match(/^-?\$[\d,]+\.\d{2}$/)) {
                  amount = text;
                  break;
                }
              }
              if (amount) break;
            }

            if (merchant || amount) {
              results.push({
                description: merchant,
                category,
                amount,
                sectionLabel: headerText,
              });
            }
          }
        }
      }

      return results;
    });

    console.log(
      `[capitalone]     Found ${rowData.length} inline transaction rows`
    );

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    for (const r of rowData) {
      if (!r.description && !r.amount) continue;

      const rawAmount = parseBalance(r.amount);
      // Capital One UI: positive amounts = charges (money out), negative = credits/payments
      // Our convention: charges = negative, credits = positive
      const isNegative =
        r.amount.startsWith("-") || r.amount.includes("\u2212");
      const amount = isNegative ? Math.abs(rawAmount) : -rawAmount;

      // Use today's date for posted transactions (exact dates are in expanded row details)
      transactions.push({
        date: todayStr,
        description: r.description,
        amount,
        category: r.category || classifyTransaction(r.description),
        isPending: false,
        accountName,
      });
    }
  } catch (err) {
    console.warn("[capitalone]     Error scraping inline transactions:", err);
  }

  return transactions;
}

/**
 * Scrape pending transactions from the "Pending Transactions" section.
 */
async function scrapePendingTransactions(
  page: Page,
  accountName: string
): Promise<Omit<Transaction, "institution">[]> {
  const transactions: Omit<Transaction, "institution">[] = [];

  try {
    const pendingData = await page.evaluate(() => {
      const sections = document.querySelectorAll(
        ".c1-ease-card-transactions-view__table"
      );

      for (const section of sections) {
        const header = section.querySelector(
          ".c1-ease-card-transactions-view__table--headersection-title"
        );
        if (!header?.textContent?.includes("Pending")) continue;

        const results: {
          description: string;
          category: string;
          amount: string;
        }[] = [];

        const bodies = section.querySelectorAll(".c1-ease-table__body");
        for (const body of bodies) {
          const descEls = body.querySelectorAll(
            ".c1-ease-txns-description"
          );

          for (const descEl of descEls) {
            const detailsEl = descEl.querySelector(
              ".c1-ease-txns-description__details"
            );

            const catEl = descEl.querySelector(
              ".c1-ease-txns-description__category"
            );
            const category = catEl?.textContent?.trim() || "";

            // Strip category suffix from merchant (textContent includes nested elements)
            let merchant =
              detailsEl?.textContent
                ?.trim()
                .replace(/\s{2,}/g, " ") || "";
            if (category && merchant.endsWith(category)) {
              merchant = merchant.slice(0, -category.length).trim();
            }

            let amount = "";
            let el: Element | null = descEl;
            for (let i = 0; i < 5; i++) {
              el = el?.parentElement || null;
              if (!el || el.classList.contains("c1-ease-table__body"))
                break;

              const negSpan = el.querySelector(
                ".c1-ease-card-transactions-view-table__amount--currency"
              );
              if (negSpan) {
                amount = negSpan.textContent?.trim() || "";
                break;
              }

              const spans = el.querySelectorAll("span");
              for (const span of spans) {
                if (span.closest(".c1-ease-txns-description")) continue;
                const text = span.textContent?.trim() || "";
                if (text.match(/^-?\$[\d,]+\.\d{2}$/)) {
                  amount = text;
                  break;
                }
              }
              if (amount) break;
            }

            if (merchant || amount) {
              results.push({ description: merchant, category, amount });
            }
          }
        }

        return results;
      }

      return [];
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    for (const r of pendingData) {
      if (!r.description && !r.amount) continue;

      const rawAmount = parseBalance(r.amount);
      const isNegative =
        r.amount.startsWith("-") || r.amount.includes("\u2212");
      const amount = isNegative ? Math.abs(rawAmount) : -rawAmount;

      transactions.push({
        date: todayStr,
        description: r.description,
        amount,
        category: r.category || classifyTransaction(r.description),
        isPending: true,
        accountName,
      });
    }
  } catch {
    // Pending section may not exist
  }

  return transactions;
}

function classifyTransaction(description: string): string | undefined {
  const d = description.toLowerCase();
  if (
    d.includes("payment") &&
    (d.includes("thank you") || d.includes("received"))
  )
    return "Payment";
  if (d.includes("autopay")) return "Payment";
  if (d.includes("credit") && d.includes("statement")) return "Credit";
  if (d.includes("refund") || d.includes("return")) return "Refund";
  return undefined;
}
