import type { Page } from "playwright";
import type { AmexOffer } from "../../types.js";

const OFFERS_URL = "https://global.americanexpress.com/offers/eligible";

/**
 * Scrape Amex Offers from the offers page.
 * Each offer shows: merchant name, reward description, expiration, and add-to-card status.
 */
export async function scrapeOffers(page: Page): Promise<AmexOffer[]> {
  console.log("[amex] Navigating to Amex Offers page...");

  try {
    await page.goto(OFFERS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(5000);

    // Wait for the offers list to appear
    const offersLoaded = await page
      .locator('[data-testid="recommendedOffersContainer"], [data-testid="listViewContainer"]')
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!offersLoaded) {
      console.log("[amex]   Offers page did not load in time.");
      return [];
    }

    // Scroll to load all offers (page may lazy-load)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Extract offer data using the discovered DOM structure:
    // Each merchant offer in data-testid="listViewContainer" has:
    // - IMG[alt] = merchant name (e.g., "TurboTax - Online, Expert Assist & Full Service")
    // - H3 = merchant name (same)
    // - data-testid="overflowTextContainer" with class containing "color-text-regular" = reward description
    // - "Expires M/DD/YY" text
    // - data-testid="merchantOfferListAddButton" = add button (presence means not yet added)
    // - data-testid="newOfferCalloutText" = "New" badge (optional)
    //
    // Card offers (Amex promos) use data-testid="cardOfferLearnLink" instead of add button

    const offers = await page.evaluate(() => {
      const results: {
        merchant: string;
        description: string;
        expires: string;
        isAdded: boolean;
      }[] = [];

      // Each merchant offer has a "View Details" button with data-testid="merchantOfferDetailsLink".
      // We use that as anchor and walk up to find the parent container for each offer.
      const detailLinks = document.querySelectorAll(
        '[data-testid="merchantOfferDetailsLink"]'
      );

      for (const link of detailLinks) {
        // Walk up to the offer's container — each offer lives in a grid column div
        // Go up several levels to find the right container
        let container: Element | null = link;
        for (let i = 0; i < 6; i++) {
          container = container?.parentElement || null;
          if (!container) break;
          // Stop if we find a container that has both the H3 and the details link
          const h3 = container.querySelector("h3");
          if (h3 && container.querySelector('[data-testid="merchantOfferDetailsLink"]') === link) {
            break;
          }
        }
        if (!container) continue;

        // Extract merchant name from H3
        const h3 = container.querySelector("h3");
        const merchant = h3?.textContent?.trim() || "";
        if (!merchant) continue;

        const text = container.textContent || "";

        // Get the description from overflowTextContainer with color-text-regular class
        const descEls = container.querySelectorAll(
          '[data-testid="overflowTextContainer"]'
        );
        let description = "";
        for (const el of descEls) {
          const elText = el.textContent?.trim() || "";
          if (el.className.includes("color-text-regular") && elText !== merchant) {
            description = elText;
            break;
          }
        }

        // Extract expiration
        let expires = "";
        const expiresMatch = text.match(
          /Expires?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i
        );
        if (expiresMatch) {
          expires = expiresMatch[1];
        }

        // Check if offer has an add button — if no add button, it's already added
        const hasAddButton =
          container.querySelector(
            '[data-testid="merchantOfferListAddButton"]'
          ) !== null;
        const isAdded = !hasAddButton;

        if (merchant && description) {
          results.push({ merchant, description, expires, isAdded });
        }
      }

      return results;
    });

    const amexOffers: AmexOffer[] = offers.map((o) => ({
      merchant: o.merchant,
      description: o.description,
      expiresAt: o.expires || undefined,
      isAdded: o.isAdded,
      rewardType: inferRewardType(o.description),
      rewardAmount: extractRewardAmount(o.description),
    }));

    // Also check the "Added to Card" tab for saved offers count
    const savedCount = await page
      .evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"], button, a');
        for (const tab of tabs) {
          const text = tab.textContent || "";
          const match = text.match(/Added to Card\s*\((\d+)\)/i);
          if (match) return parseInt(match[1], 10);
        }
        return 0;
      })
      .catch(() => 0);

    console.log(
      `[amex]   Found ${amexOffers.length} Amex Offers (${savedCount} added to card)`
    );
    return amexOffers;
  } catch (err) {
    console.warn("[amex] Could not scrape offers:", err);
    return [];
  }
}

function inferRewardType(description: string): "credit" | "points" {
  const d = description.toLowerCase();
  if (
    d.includes("point") ||
    d.includes("membership reward") ||
    d.includes("mr point")
  ) {
    return "points";
  }
  return "credit";
}

function extractRewardAmount(description: string): string | undefined {
  // Prefer "earn $X" or "$X back/credit" over "spend $X"
  const earnMatch = description.match(
    /earn\s+(\$[\d,]+(?:\.\d{2})?)/i
  );
  if (earnMatch) return earnMatch[1];

  const backMatch = description.match(
    /(\$[\d,]+(?:\.\d{2})?)\s*(?:back|credit|off)/i
  );
  if (backMatch) return backMatch[1];

  const percentMatch = description.match(/(\d+)%\s*(?:back|off|credit)/i);
  if (percentMatch) return `${percentMatch[1]}%`;

  const pointsMatch = description.match(
    /([\d,]+)\s*(?:points|pts|membership rewards?)/i
  );
  if (pointsMatch) return `${pointsMatch[1]} points`;

  // Fallback: up to total of $X
  const upToMatch = description.match(
    /up to (?:a total of )?(\$[\d,]+(?:\.\d{2})?)/i
  );
  if (upToMatch) return upToMatch[1];

  // Last resort: first dollar amount
  const dollarMatch = description.match(/\$\d[\d,]*/);
  if (dollarMatch) return dollarMatch[0];

  return undefined;
}
