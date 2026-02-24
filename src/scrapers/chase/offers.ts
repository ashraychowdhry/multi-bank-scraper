import type { Page } from "playwright";
import type { ChaseOffer } from "../../types.js";
import { afterNavigation } from "../popup-guard.js";

type OfferData = Omit<ChaseOffer, "institution">;

const OFFERS_HUB_BASE =
  "https://secure.chase.com/web/auth/dashboard#/dashboard/merchantOffers/offer-hub";

/**
 * Scrape Chase Offers from the dedicated offers hub page.
 * Navigates to the offers hub for the first account found,
 * then parses all commerce-tile elements.
 */
export async function scrapeOffers(page: Page): Promise<OfferData[]> {
  console.log("[chase] Scraping Chase Offers...");

  try {
    // Get the account ID from the dashboard for the offers URL
    const accountId = await page
      .locator('[data-testid^="accounts-name-link-button-"]')
      .first()
      .getAttribute("data-testid")
      .then((id) => id?.replace("accounts-name-link-button-", ""))
      .catch(() => null);

    if (!accountId) {
      console.log("[chase] Could not find account ID for offers hub.");
      return [];
    }

    // Get account name for the offers
    const accountName = await page
      .locator(`[data-testid="accounts-name-link-button-${accountId}"]`)
      .getAttribute("text")
      .then((t) => t?.trim() || "")
      .catch(() => "");

    // Navigate to the offers hub
    const offersUrl = `${OFFERS_HUB_BASE}?accountId=${accountId}`;
    console.log(`[chase] Navigating to offers hub for account ${accountId}...`);
    await page.goto(offersUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await afterNavigation(page, { scraperName: "chase" });

    // Wait for commerce tiles to render (SPA page needs time)
    try {
      await page.waitForSelector('[data-testid="commerce-tile"]', {
        timeout: 15000,
      });
    } catch {
      console.log("[chase] No offers loaded on hub page.");
      return [];
    }

    // Give extra time for all tiles to render
    await page.waitForTimeout(3000);

    // Scroll down to ensure all tiles are loaded
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(500);
    }

    // Extract all tile data in a single browser evaluate call (avoids 4+ async calls per tile)
    const rawTiles = await page.evaluate(() => {
      const tiles = document.querySelectorAll('[data-testid="commerce-tile"]');
      return Array.from(tiles).map((el) => ({
        text: (el.textContent || "").trim(),
        hasExpiringSoon: !!el.querySelector('[data-testid="expiring-soon"]'),
        daysLeft: el.querySelector('[data-testid="days-left-banner"]')?.textContent?.trim() || "",
        isActivated: !!el.querySelector('[data-testid="offer-tile-alert-container-success"]'),
      }));
    });

    console.log(`[chase] Found ${rawTiles.length} offer tiles on hub page.`);

    const offers: OfferData[] = [];
    const seenMerchants = new Set<string>();

    for (const raw of rawTiles) {
      const offer = parseTile(raw, accountName);
      if (offer && !seenMerchants.has(offer.merchant)) {
        seenMerchants.add(offer.merchant);
        offers.push(offer);
      }
    }

    console.log(`[chase] Scraped ${offers.length} unique offers.`);
    return offers;
  } catch (err) {
    console.warn("[chase] Failed to scrape offers:", err);
    return [];
  }
}

interface RawTile {
  text: string;
  hasExpiringSoon: boolean;
  daysLeft: string;
  isActivated: boolean;
}

function parseTile(raw: RawTile, accountName: string): OfferData | null {
  if (!raw.text) return null;

  let parseText = raw.text
    .replace(/Expiring soon$/i, "")
    .replace(/\d+d left$/i, "")
    .trim();

  const rewardMatch = parseText.match(
    /(Up to \$[\d,]+\s*(?:cash\s*)?back|Up to \d+%\s*(?:cash\s*)?back|\$[\d,]+\s*(?:cash\s*)?back|\d+%\s*(?:cash\s*)?back|\$[\d,]+\s*back|\d+%\s*back)/i
  );

  if (!rewardMatch || rewardMatch.index === undefined) return null;

  const merchant = parseText.slice(0, rewardMatch.index).trim();
  if (!merchant) return null;

  return {
    merchant,
    reward: rewardMatch[0].trim(),
    isExpiringSoon: raw.hasExpiringSoon || !!raw.daysLeft,
    daysLeft: raw.daysLeft || undefined,
    isActivated: raw.isActivated,
    accountName,
  };
}
