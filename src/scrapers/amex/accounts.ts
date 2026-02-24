import type { Page } from "playwright";
import type { AccountType, AmexCreditCardDetails } from "../../types.js";
import { parseBalance } from "../utils.js";
import { DASHBOARD_URL } from "./login.js";

// Internal type without institution field — added by AmexScraper.scrape()
export interface AmexAccountData {
  name: string;
  type: AccountType;
  currentBalance: number;
  availableBalance?: number;
  accountNumber: string;
}

export async function scrapeAccounts(page: Page): Promise<{
  accounts: AmexAccountData[];
  cardDetails: AmexCreditCardDetails | null;
}> {
  console.log("[amex] Scraping account summary...");

  if (!page.url().includes("global.americanexpress.com/dashboard")) {
    await page.goto(DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
  }
  await page.waitForTimeout(5000);

  const accounts: AmexAccountData[] = [];
  let cardDetails: AmexCreditCardDetails | null = null;

  try {
    // Card name from card switcher: data-testid="simple_switcher_display_name"
    const cardName = await page
      .locator('[data-testid="simple_switcher_display_name"]')
      .first()
      .textContent()
      .then((t) => t?.trim() || "Amex Card")
      .catch(() => "Amex Card");
    console.log(`[amex]   Card: ${cardName}`);

    // Card number from: data-testid="simple_switcher_display_number_val"
    // Text is like "••••51001"
    const cardNumberRaw = await page
      .locator('[data-testid="simple_switcher_display_number_val"]')
      .first()
      .textContent()
      .then((t) => t?.trim() || "")
      .catch(() => "");
    const accountNumber = cardNumberRaw.replace(/[^0-9]/g, "") || "amex";

    // Dashboard has three H1.heading-sans-medium-bold elements:
    // 1. Remaining Statement Balance (e.g., "$1,979.61")
    // 2. Payment Due Date (e.g., "March 13" — not a dollar amount, it's an H1 too)
    // 3. Total Balance (e.g., "$4,352.80")
    //
    // We also have:
    // - Minimum Payment: a SPAN with text "$39.59" near "Minimum Payment Due"
    // - "No Preset Spending Limit" (no numeric credit limit)

    // Extract all H1 amounts on the dashboard
    const dashboardData = await page.evaluate(() => {
      // Get all H1 elements
      const h1s = Array.from(document.querySelectorAll("h1"));
      const amounts: string[] = [];
      let paymentDueDate = "";

      for (const h1 of h1s) {
        const text = h1.textContent?.trim() || "";
        const dollarMatch = text.match(/^\$[\d,]+\.\d{2}$/);
        if (dollarMatch) {
          amounts.push(dollarMatch[0]);
        } else if (text.match(/^[A-Z][a-z]+\s+\d{1,2}$/)) {
          // Date like "March 13"
          paymentDueDate = text;
        }
      }

      // Find minimum payment near "Minimum Payment Due" text
      let minimumPayment = "";
      const allText = document.body.textContent || "";
      const minPayMatch = allText.match(
        /Minimum Payment Due[^$]*(\$[\d,]+\.\d{2})/
      );
      if (minPayMatch) {
        minimumPayment = minPayMatch[1];
      }

      // Check for "No Preset Spending Limit" vs credit limit
      const noPresetLimit = allText.includes("No Preset Spending Limit");
      let creditLimit = "";
      if (!noPresetLimit) {
        const creditLimitMatch = allText.match(
          /Credit Limit[^$]*(\$[\d,]+\.\d{2})/
        );
        if (creditLimitMatch) {
          creditLimit = creditLimitMatch[1];
        }
      }

      // Check for available credit
      let availableCredit = "";
      const availCreditMatch = allText.match(
        /Available Credit[^$]*(\$[\d,]+\.\d{2})/
      );
      if (availCreditMatch) {
        availableCredit = availCreditMatch[1];
      }

      return {
        amounts,
        paymentDueDate,
        minimumPayment,
        creditLimit,
        availableCredit,
        noPresetLimit,
      };
    });

    console.log(
      `[amex]   Dashboard amounts: ${dashboardData.amounts.join(", ")}`
    );
    console.log(
      `[amex]   Payment due: ${dashboardData.paymentDueDate}, Min payment: ${dashboardData.minimumPayment}`
    );

    // First H1 dollar amount = statement balance, second = total balance
    const statementBalance =
      dashboardData.amounts.length > 0
        ? parseBalance(dashboardData.amounts[0])
        : 0;
    const totalBalance =
      dashboardData.amounts.length > 1
        ? parseBalance(dashboardData.amounts[1])
        : statementBalance;
    const minimumPayment = dashboardData.minimumPayment
      ? parseBalance(dashboardData.minimumPayment)
      : 0;
    const creditLimit = dashboardData.creditLimit
      ? parseBalance(dashboardData.creditLimit)
      : 0;
    const availableCredit = dashboardData.availableCredit
      ? parseBalance(dashboardData.availableCredit)
      : 0;

    // Normalize due date: "March 13" → "2026-03-13"
    let paymentDueDate = "";
    if (dashboardData.paymentDueDate) {
      const currentYear = new Date().getFullYear();
      const parsed = Date.parse(
        `${dashboardData.paymentDueDate}, ${currentYear}`
      );
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        paymentDueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      } else {
        paymentDueDate = dashboardData.paymentDueDate;
      }
    }

    if (totalBalance !== 0 || accountNumber) {
      accounts.push({
        name: cardName,
        type: "credit",
        currentBalance: totalBalance,
        availableBalance: availableCredit || undefined,
        accountNumber,
      });
    }

    if (totalBalance !== 0) {
      cardDetails = {
        statementBalance,
        totalBalance,
        minimumPayment,
        paymentDueDate,
        creditLimit,
        availableCredit,
        lastPaymentAmount: undefined,
        lastPaymentDate: undefined,
      };
    }
  } catch (err) {
    console.warn("[amex] Error scraping accounts:", err);
  }

  console.log(`[amex]   Found ${accounts.length} account(s)`);
  return { accounts, cardDetails };
}
