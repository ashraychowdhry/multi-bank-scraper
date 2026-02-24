import type { Page } from "playwright";
import type { AccountType, CapitalOneCardDetails } from "../../types.js";
import { parseBalance } from "../utils.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";
import { DASHBOARD_URL } from "./login.js";

// Internal type without institution field — added by CapitalOneScraper.scrape()
export interface CapitalOneAccountData {
  name: string;
  type: AccountType;
  currentBalance: number;
  availableBalance?: number;
  accountNumber: string; // last 4 digits
  viewAccountTestId?: string; // data-testid of the "View Account" button
  actionBtnText?: string; // "View Account" or "Make a payment" — only navigate for "View Account"
}

interface DiscoveredCard {
  name: string;
  lastFour: string;
  balance: number;
  viewAccountTestId: string;
  actionBtnText: string; // "View Account" or "Make a payment" — only click "View Account"
}

export async function scrapeAccounts(
  page: Page,
  cardFilter: string[] | null
): Promise<{
  accounts: CapitalOneAccountData[];
  cardDetails: CapitalOneCardDetails[];
}> {
  console.log("[capitalone] Scraping account summary...");

  if (!page.url().includes("myaccounts.capitalone.com/accountSummary")) {
    await page.goto(DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
  }
  await afterNavigation(page, { scraperName: "capitalone" });
  await page.waitForTimeout(4000);
  await dismissPopups(page, { scraperName: "capitalone" });

  const accounts: CapitalOneAccountData[] = [];
  const cardDetails: CapitalOneCardDetails[] = [];

  // Discover all credit card tiles on the dashboard
  const discoveredCards = await discoverCards(page);
  console.log(
    `[capitalone]   Found ${discoveredCards.length} card(s): ${discoveredCards.map((c) => `${c.name} (...${c.lastFour})`).join(", ")}`
  );

  // Apply card filter
  const cardsToScrape = discoveredCards.filter((card) =>
    shouldScrapeCard(card.name, cardFilter)
  );

  if (cardFilter) {
    console.log(
      `[capitalone]   Card filter: [${cardFilter.join(", ")}] → scraping ${cardsToScrape.length} card(s)`
    );
  }

  // Scrape rewards info from dashboard (visible for all cards combined)
  const rewardsText = await scrapeRewardsFromDashboard(page);

  for (const card of cardsToScrape) {
    try {
      // Add basic account info from the dashboard tile
      accounts.push({
        name: card.name,
        type: "credit",
        currentBalance: card.balance,
        accountNumber: card.lastFour,
        viewAccountTestId: card.viewAccountTestId,
        actionBtnText: card.actionBtnText,
      });

      // Navigate to card detail page for extended info
      const details = await scrapeCardDetails(page, card, rewardsText);
      if (details) {
        cardDetails.push(details);
      }

      // Return to dashboard for next card
      if (cardsToScrape.indexOf(card) < cardsToScrape.length - 1) {
        await page.goto(DASHBOARD_URL, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page, { scraperName: "capitalone" });
      }
    } catch (err) {
      console.warn(
        `[capitalone]   Error scraping card "${card.name}":`,
        err
      );
    }
  }

  console.log(`[capitalone]   ${accounts.length} account(s) scraped`);
  return { accounts, cardDetails };
}

async function discoverCards(page: Page): Promise<DiscoveredCard[]> {
  // Capital One dashboard structure:
  // - Each card is in a div.account-tile container
  // - Card name is in img[role="heading"] alt attribute (e.g., "Venture X", "Savor")
  // - Last 4 digits: text pattern "...XXXX  ending in ...XXXX"
  // - Balance: span.sr-only with text "CURRENT BALANCE: $X,XXX.XX"
  // - "View Account" button: button[data-testid^="summary-"]

  const cards = await page.evaluate(() => {
    const tiles = document.querySelectorAll("div.account-tile");
    const results: {
      name: string;
      lastFour: string;
      balance: string;
      viewAccountTestId: string;
      actionBtnText: string;
    }[] = [];

    for (const tile of tiles) {
      // Card name from img[role="heading"] alt
      const nameImg = tile.querySelector('img[role="heading"]');
      const name = nameImg?.getAttribute("alt") || "";

      // Get the tile's full text for parsing
      const tileText = tile.textContent || "";

      // Last 4 digits: pattern "...XXXX" or "ending in ...XXXX"
      const last4Match = tileText.match(/\.\.\.(\d{4})/);
      const lastFour = last4Match ? last4Match[1] : "";

      // Balance from sr-only spans: one says "ending in ...XXXX", another says "CURRENT BALANCE: $X,XXX.XX"
      // Must check ALL sr-only spans since querySelector only returns the first
      const srOnlys = tile.querySelectorAll("span.sr-only");
      let balance = "$0.00";
      for (const sr of srOnlys) {
        const srText = sr.textContent || "";
        const balanceMatch = srText.match(/CURRENT BALANCE:\s*(\$[\d,]+\.\d{2})/);
        if (balanceMatch) {
          balance = balanceMatch[1];
          break;
        }
      }

      // "View Account" or "Make a payment" button with data-testid
      const actionBtn = tile.querySelector(
        'button[data-testid^="summary-"]'
      );
      const viewAccountTestId =
        actionBtn?.getAttribute("data-testid") || "";

      const actionBtnText = actionBtn?.textContent?.trim() || "";

      if (name || lastFour) {
        results.push({
          name: name || `Card ending in ${lastFour}`,
          lastFour,
          balance,
          viewAccountTestId,
          actionBtnText,
        });
      }
    }

    return results;
  });

  return cards.map((c) => ({
    name: c.name,
    lastFour: c.lastFour,
    balance: parseBalance(c.balance),
    viewAccountTestId: c.viewAccountTestId,
    actionBtnText: c.actionBtnText,
  }));
}

async function scrapeRewardsFromDashboard(page: Page): Promise<string> {
  // The rewards section on the dashboard shows combined rewards
  // like "139,555 Miles |&| $1,227.26 Rewards cash"
  try {
    const rewardsText = await page.evaluate(() => {
      const allText = document.body.textContent || "";
      // Look for miles pattern
      const milesMatch = allText.match(/([\d,]+)\s*Miles/);
      const cashMatch = allText.match(
        /\$\s*([\d,]+(?:\.\d{2})?)\s*Rewards\s*cash/i
      );
      const parts: string[] = [];
      if (milesMatch) parts.push(`${milesMatch[1]} miles`);
      if (cashMatch) parts.push(`$${cashMatch[1]} rewards cash`);
      return parts.join(", ");
    });
    if (rewardsText) {
      console.log(`[capitalone]   Rewards: ${rewardsText}`);
    }
    return rewardsText;
  } catch {
    return "";
  }
}

async function scrapeCardDetails(
  page: Page,
  card: DiscoveredCard,
  rewardsText: string
): Promise<CapitalOneCardDetails | null> {
  try {
    if (!card.viewAccountTestId) {
      return makeFallbackDetails(card, rewardsText);
    }

    // Navigate to card detail page:
    // - If button says "View Account", click it
    // - Otherwise (e.g. "Make a payment"), navigate directly via URL
    //   URL pattern: /Card/{cardId} where cardId = testid minus "summary-" prefix
    if (card.actionBtnText === "View Account") {
      const btn = page.locator(
        `button[data-testid="${card.viewAccountTestId}"]`
      );
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(
          `[capitalone]   Clicking "View Account" for ${card.name}...`
        );
        await btn.click();
        await page.waitForTimeout(5000);
        await afterNavigation(page, { scraperName: "capitalone" });
      } else {
        return makeFallbackDetails(card, rewardsText);
      }
    } else {
      // Direct URL navigation — extract card ID from data-testid
      const cardId = card.viewAccountTestId.replace(/^summary-/, "");
      const cardUrl = `https://myaccounts.capitalone.com/Card/${encodeURIComponent(cardId)}`;
      console.log(
        `[capitalone]   Navigating directly to ${card.name} detail page...`
      );
      await page.goto(cardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(5000);
      await afterNavigation(page, { scraperName: "capitalone" });
    }

    console.log(`[capitalone]   Card detail URL: ${page.url()}`);

    // Extract card detail data using Capital One's actual DOM structure
    // Hero section: c1-ease-account-hero contains all key data
    // - Current balance: cdk-visually-hidden inside c1-ease-account-hero__secondary-content
    // - MIN/DUE: c1-ease-account-details-top-right-grid-cell__due-msg → "MIN $88.00 DUE Mar 18"
    // - Available credit: cdk-visually-hidden inside c1-ease-account-details-bottom-middle-grid-cell
    // - Last Statement + Credit Line: c1-ease-account-hero-bottom-right-grid-cell
    // - Rewards: c1-ease-account-hero-bottom-left-grid-cell
    const detailData = await page.evaluate(() => {
      // Current balance from cdk-visually-hidden in the balance section
      const balanceSection = document.querySelector(".c1-ease-account-hero__secondary-content");
      const balanceHidden = balanceSection?.querySelector(".cdk-visually-hidden");
      const currentBalance = balanceHidden?.textContent?.trim() || "";

      // MIN + DUE from the due-msg element: "MIN $88.00 DUE Mar 18"
      const dueMsg = document.querySelector(".c1-ease-account-details-top-right-grid-cell__due-msg");
      const dueMsgText = dueMsg?.textContent?.trim() || "";
      const minMatch = dueMsgText.match(/MIN\s+(\$[\d,]+\.\d{2})/);
      const dueMatch = dueMsgText.match(/DUE\s+([A-Za-z]+\s+\d{1,2})/);
      const minimumPayment = minMatch ? minMatch[1] : "";
      const paymentDueDate = dueMatch ? dueMatch[1] : "";

      // Available credit from cdk-visually-hidden near "Available Credit" label
      const availSection = document.querySelector(".c1-ease-account-details-bottom-middle-grid-cell");
      const availHidden = availSection?.querySelector(".cdk-visually-hidden");
      const availableCredit = availHidden?.textContent?.trim() || "";

      // Last Statement + Credit Line from bottom-right cell
      // Text: "Last Statement  $8,891.67  Credit Line  $30,000.00"
      const bottomRight = document.querySelector(".c1-ease-account-hero-bottom-right-grid-cell");
      const bottomRightText = bottomRight?.textContent || "";
      const lastStmtMatch = bottomRightText.match(/Last Statement\s+\$?([\d,]+(?:\.\d{2})?)/);
      const creditLineMatch = bottomRightText.match(/Credit Line\s+\$?([\d,]+(?:\.\d{2})?)/);
      const statementBalance = lastStmtMatch ? `$${lastStmtMatch[1]}` : "";
      const creditLimit = creditLineMatch ? `$${creditLineMatch[1]}` : "";

      // Rewards from bottom-left cell
      const rewardsEl = document.querySelector(".c1-ease-account-hero-bottom-left-grid-cell");
      const rewardsText = rewardsEl?.textContent?.replace(/View Rewards/gi, "").trim() || "";

      return {
        currentBalance,
        statementBalance,
        minimumPayment,
        paymentDueDate,
        creditLimit,
        availableCredit,
        rewardsBalance: rewardsText,
      };
    });

    console.log(
      `[capitalone]   Detail: balance=${detailData.currentBalance || "?"}, ` +
        `stmt=${detailData.statementBalance || "?"}, limit=${detailData.creditLimit || "?"}, ` +
        `avail=${detailData.availableCredit || "?"}, ` +
        `due=${detailData.paymentDueDate || "?"}, min=${detailData.minimumPayment || "?"}, ` +
        `rewards=${detailData.rewardsBalance || "?"}`
    );

    // Normalize payment due date (e.g., "Mar 18" → "2026-03-18")
    let paymentDueDate = "";
    if (detailData.paymentDueDate) {
      const currentYear = new Date().getFullYear();
      const dateStr = `${detailData.paymentDueDate}, ${currentYear}`;
      const parsed = Date.parse(dateStr);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        paymentDueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      } else {
        paymentDueDate = detailData.paymentDueDate;
      }
    }

    return {
      cardName: card.name,
      lastFourDigits: card.lastFour,
      statementBalance:
        parseBalance(detailData.statementBalance) || card.balance,
      totalBalance: parseBalance(detailData.currentBalance) || card.balance,
      minimumPayment: parseBalance(detailData.minimumPayment),
      paymentDueDate,
      creditLimit: parseBalance(detailData.creditLimit),
      availableCredit: parseBalance(detailData.availableCredit),
      rewardsBalance: detailData.rewardsBalance || rewardsText || undefined,
    };
  } catch (err) {
    console.warn(
      `[capitalone]   Error on detail page for "${card.name}":`,
      err
    );
    return makeFallbackDetails(card, rewardsText);
  }
}

function makeFallbackDetails(
  card: DiscoveredCard,
  rewardsText: string
): CapitalOneCardDetails {
  return {
    cardName: card.name,
    lastFourDigits: card.lastFour,
    statementBalance: card.balance,
    totalBalance: card.balance,
    minimumPayment: 0,
    paymentDueDate: "",
    creditLimit: 0,
    availableCredit: 0,
    rewardsBalance: rewardsText || undefined,
  };
}

function shouldScrapeCard(
  cardName: string,
  filter: string[] | null
): boolean {
  if (!filter) return true; // no filter = scrape all
  const name = cardName.toLowerCase();
  // Bidirectional match: "savor" matches filter "savorone", and "savorone" matches card "savor"
  return filter.some((f) => name.includes(f) || f.includes(name));
}
