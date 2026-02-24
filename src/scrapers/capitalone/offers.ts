import type { Page } from "playwright";
import type { CapitalOneOffer } from "../../types.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";
import { DASHBOARD_URL } from "./login.js";

/**
 * Scrape Capital One shopping offers from the dashboard.
 *
 * Capital One shows shopping offers directly on the Account Summary page
 * as div[role="button"] elements with class c1-ease-dte-basic-offer__SHOPPING_PLATFORM_OFFER_V2.
 * Each has an aria-label like "Sephora, Up to 8% back, Earn now".
 *
 * There's also a "View all offers" button that may lead to more offers.
 * The dedicated /Card/offers page is broken (shows error), so we scrape from dashboard.
 */
export async function scrapeOffers(page: Page): Promise<CapitalOneOffer[]> {
  console.log("[capitalone] Scraping shopping offers from dashboard...");

  try {
    // Make sure we're on the dashboard
    if (!page.url().includes("myaccounts.capitalone.com/accountSummary")) {
      await page.goto(DASHBOARD_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await afterNavigation(page, { scraperName: "capitalone" });
      await page.waitForTimeout(4000);
    }

    // First, try clicking "View all offers" to get the full list
    const viewAllBtn = page.locator('button:has-text("View all offers")').first();
    let navigatedToOffersPage = false;
    if (await viewAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("[capitalone]   Clicking 'View all offers'...");
      await viewAllBtn.click();
      await page.waitForTimeout(5000);
      await dismissPopups(page, { scraperName: "capitalone" });

      // Check if we navigated somewhere useful (not an error page)
      const hasError = await page
        .locator('text="Oops, we\'ve hit a snag"')
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (hasError) {
        console.log("[capitalone]   Offers page showed error, using dashboard offers");
        // Dismiss the error dialog and go back
        await page.locator('button:has-text("Okay")').click().catch(() => {});
        await page.waitForTimeout(1000);
        await page.goto(DASHBOARD_URL, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(4000);
      } else {
        navigatedToOffersPage = true;
        // Scroll to load more offers
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 2000));
          await page.waitForTimeout(1500);
        }
      }
    }

    // Extract shopping offers from current page
    const offers = await page.evaluate(() => {
      const results: {
        merchant: string;
        reward: string;
        isToday: boolean;
      }[] = [];

      // Strategy 1: Shopping offer tiles on dashboard
      // Each is: div[role="button"].c1-ease-dte-basic-offer__SHOPPING_PLATFORM_OFFER_V2
      // aria-label = "Sephora, Up to 8% back, Earn now" or "Columbia, 30% back, Earn now, Today Only"
      const offerEls = document.querySelectorAll(
        'div[role="button"][class*="c1-ease-dte-basic-offer"]'
      );

      for (const el of offerEls) {
        const ariaLabel = el.getAttribute("aria-label") || "";
        if (!ariaLabel) continue;

        // Parse aria-label: "Merchant, Reward, Earn now[, Today Only]"
        const parts = ariaLabel.split(",").map((s) => s.trim());
        const merchant = parts[0] || "";
        const reward = parts[1] || "";
        const isToday = ariaLabel.toLowerCase().includes("today only");

        if (merchant && reward) {
          results.push({ merchant, reward, isToday });
        }
      }

      // Strategy 2: If on an expanded offers page, look for more structured offer cards
      if (results.length === 0) {
        const offerCards = document.querySelectorAll(
          '[class*="offer-card"], [class*="OfferCard"], [data-testid*="offer"]'
        );
        for (const card of offerCards) {
          const text = card.textContent || "";
          const ariaLabel = card.getAttribute("aria-label") || "";
          const label = ariaLabel || text;

          const parts = label.split(",").map((s) => s.trim());
          if (parts.length >= 2) {
            results.push({
              merchant: parts[0],
              reward: parts[1],
              isToday: label.toLowerCase().includes("today only"),
            });
          }
        }
      }

      return results;
    });

    const capitalOneOffers: CapitalOneOffer[] = offers.map((o) => ({
      merchant: o.merchant,
      description: o.reward,
      expiresAt: o.isToday ? "Today" : undefined,
      isAdded: false, // Shopping offers are "Earn now" — not "added to card"
      rewardType: inferRewardType(o.reward),
      rewardAmount: extractRewardAmount(o.reward),
    }));

    // If we navigated away, go back to dashboard
    if (navigatedToOffersPage) {
      await page.goto(DASHBOARD_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(3000);
    }

    console.log(`[capitalone]   Found ${capitalOneOffers.length} shopping offer(s)`);
    return capitalOneOffers;
  } catch (err) {
    console.warn("[capitalone] Could not scrape offers:", err);
    return [];
  }
}

function inferRewardType(
  description: string
): "cash back" | "miles" | "other" {
  const d = description.toLowerCase();
  if (d.includes("mile")) return "miles";
  if (
    d.includes("back") ||
    d.includes("cashback") ||
    d.includes("credit") ||
    d.includes("%")
  ) {
    return "cash back";
  }
  return "other";
}

function extractRewardAmount(description: string): string | undefined {
  // "Up to 8% back" → "8%"
  const percentMatch = description.match(/(\d+)%\s*back/i);
  if (percentMatch) return `${percentMatch[1]}%`;

  // "30% back" → "30%"
  const directPercent = description.match(/^(\d+)%/);
  if (directPercent) return `${directPercent[1]}%`;

  // "$X back"
  const cashMatch = description.match(/(\$[\d,]+(?:\.\d{2})?)\s*back/i);
  if (cashMatch) return cashMatch[1];

  // "Up to $X"
  const upToMatch = description.match(/up to\s+(\$[\d,]+(?:\.\d{2})?)/i);
  if (upToMatch) return upToMatch[1];

  // "Up to X% back"
  const upToPercent = description.match(/up to\s+(\d+)%/i);
  if (upToPercent) return `${upToPercent[1]}%`;

  return description || undefined;
}
