import type { Page } from "playwright";
import type { CapitalOneOffer } from "../../types.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";
import { DASHBOARD_URL } from "./login.js";

/**
 * Scrape Capital One shopping offers.
 *
 * "View all offers" on the dashboard opens a new browser tab to the Capital One
 * Shopping portal. We capture that new page, scroll to load all offers, and
 * scrape merchant name, reward, and expiration date from each offer card.
 *
 * Fallback: if the new tab doesn't open or errors, scrape from dashboard tiles.
 */
export async function scrapeOffers(page: Page): Promise<CapitalOneOffer[]> {
  console.log("[capitalone] Scraping shopping offers...");

  try {
    // Navigate to dashboard and wait for full render
    await page.goto(DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await afterNavigation(page, { scraperName: "capitalone" });
    await page.waitForTimeout(5000);
    await dismissPopups(page, { scraperName: "capitalone" });

    // Scroll down to find the offers section (it's below account tiles)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(800);
    }

    // Try multiple patterns for the "View all offers" button/link
    const viewAllSelectors = [
      'button:has-text("View all offers")',
      'a:has-text("View all offers")',
      'button:has-text("View offers")',
      'a:has-text("View offers")',
      'button:has-text("See all offers")',
      'a:has-text("See all offers")',
      'button:has-text("Shopping offers")',
      'a:has-text("Shopping offers")',
      '[data-testid*="offers"] button',
      '[data-testid*="offers"] a',
    ];

    let viewAllBtn = null;
    for (const selector of viewAllSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        viewAllBtn = btn;
        console.log(`[capitalone]   Found offers button: "${selector}"`);
        break;
      }
    }

    if (!viewAllBtn) {
      console.log(
        "[capitalone]   Offers button not found, scraping from dashboard tiles"
      );
      return scrapeDashboardOffers(page);
    }

    console.log("[capitalone]   Clicking 'View all offers'...");
    const context = page.context();

    // Listen for a new page (tab) opening while we click
    const newPagePromise = context
      .waitForEvent("page", { timeout: 10000 })
      .catch(() => null);
    await viewAllBtn.click();
    const newPage = await newPagePromise;

    if (newPage) {
      // New tab opened — scrape offers from there
      console.log("[capitalone]   Offers opened in new tab");
      await newPage.waitForLoadState("domcontentloaded");
      await newPage.waitForTimeout(5000);

      const offers = await scrapeOffersFromPage(newPage);
      await newPage.close();
      console.log(
        `[capitalone]   Found ${offers.length} shopping offer(s)`
      );
      return offers;
    }

    // No new tab — check if we navigated in the same page
    await page.waitForTimeout(5000);
    await dismissPopups(page, { scraperName: "capitalone" });

    // Check for error page
    const hasError = await page
      .locator('text="Oops, we\'ve hit a snag"')
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (hasError) {
      console.log(
        "[capitalone]   Offers page showed error, using dashboard offers"
      );
      await page
        .locator('button:has-text("Okay")')
        .click()
        .catch(() => {});
      await page.waitForTimeout(1000);
      await page.goto(DASHBOARD_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(4000);
      return scrapeDashboardOffers(page);
    }

    // Same-tab navigation to offers page
    const offers = await scrapeOffersFromPage(page);

    // Navigate back to dashboard
    await page.goto(DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    console.log(
      `[capitalone]   Found ${offers.length} shopping offer(s)`
    );
    return offers;
  } catch (err) {
    console.warn("[capitalone] Could not scrape offers:", err);
    return [];
  }
}

/**
 * Scrape offers from the dedicated offers/shopping page (capitaloneoffers.com).
 * First dumps the DOM structure to discover selectors, then extracts offers.
 */
async function scrapeOffersFromPage(
  page: Page
): Promise<CapitalOneOffer[]> {
  const url = page.url();
  console.log(`[capitalone]   Offers page URL: ${url}`);

  // Wait for content to render
  await page.waitForTimeout(5000);

  // Scroll to load all offers
  let previousCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(1200);

    const currentCount = await page
      .evaluate(() =>
        document.querySelectorAll("img[alt]").length +
        document.querySelectorAll("[data-testid]").length
      )
      .catch(() => 0);

    if (currentCount === previousCount && i > 3) break;
    previousCount = currentCount;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Extract offers using feed-tile elements (capitaloneoffers.com)
  // IMPORTANT: No const arrow function declarations inside evaluate — TSX adds
  // __name() wrappers that don't exist in the browser context.
  const rawOffers = await page.evaluate(() => {
    var results: {
      merchant: string;
      reward: string;
      expires: string;
      isAdded: boolean;
    }[] = [];
    var seen = new Set<string>();
    var rewardRe =
      /(Up to \d+%\s*(?:cash\s*)?back|\d+%\s*(?:cash\s*)?back|\$[\d,]+(?:\.\d{2})?\s*(?:cash\s*)?back|\d+x?\s*miles?)/i;
    var expRe1 =
      /(?:expires?|ends?|valid (?:through|until)|exp\.?)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i;
    var expRe2 =
      /(?:expires?|ends?|valid (?:through|until))\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:,?\s+\d{4})?)/i;
    var dateRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;

    // Strategy 1: data-testid="feed-tile-..." elements (capitaloneoffers.com)
    // The data-testid contains base64-encoded JSON with merchantTLD.
    // Tile text has "OnlineX% back" but no visible merchant name.
    var feedTiles = document.querySelectorAll('[data-testid^="feed-tile-"]');
    for (var tile of feedTiles) {
      var tileText = tile.textContent?.trim() || "";
      var rm = tileText.match(rewardRe);
      if (!rm) continue;

      // Decode merchant name from base64-encoded data-testid
      var testId = tile.getAttribute("data-testid") || "";
      var b64 = testId.replace(/^feed-tile-/, "");
      var merchant = "";
      try {
        var decoded = JSON.parse(atob(b64));
        var tld = decoded?.inventory?.merchantTLD || "";
        // Convert TLD to merchant name: "macys.com" → "Macys", "turbotax.intuit.com" → "TurboTax"
        if (tld) {
          var parts = tld.split(".");
          // Use first part unless it's a subdomain of a known parent (e.g., turbotax.intuit.com → turbotax)
          merchant = parts[0] || "";
          // Capitalize first letter
          if (merchant) {
            merchant = merchant.charAt(0).toUpperCase() + merchant.slice(1);
          }
        }
      } catch (_e) {
        // Can't decode — skip
      }
      if (!merchant) continue;

      var key = (merchant + "|" + (rm[0] || "")).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Check for expiration
      var expires = "";
      var em1 = tileText.match(expRe1);
      if (em1) { expires = em1[1]; }
      else {
        var em2 = tileText.match(expRe2);
        if (em2) { expires = em2[1]; }
        else if (/today only/i.test(tileText)) { expires = "Today"; }
        else if (/ending soon/i.test(tileText)) { expires = "Ending soon"; }
        else {
          var em3 = tileText.match(dateRe);
          if (em3) { expires = em3[1]; }
        }
      }

      results.push({
        merchant: merchant,
        reward: rm[0].trim(),
        expires: expires,
        isAdded: /activated|added/i.test(tileText),
      });
    }

    // Strategy 2: Dashboard-style offer tiles with aria-label (fallback)
    if (results.length === 0) {
      var offerEls = document.querySelectorAll(
        'div[role="button"][class*="offer"], div[role="button"][class*="c1-ease-dte"]'
      );
      for (var el of offerEls) {
        var ariaLabel = el.getAttribute("aria-label") || "";
        if (!ariaLabel) continue;
        var ariaParts = ariaLabel.split(",").map(function(s) { return s.trim(); });
        var m = ariaParts[0] || "";
        var r = ariaParts[1] || "";
        if (!m || !r) continue;
        var k = (m + "|" + r).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        var fullText = ariaLabel + " " + (el.textContent || "");
        var exp = "";
        if (/today only/i.test(fullText)) exp = "Today";
        var em = fullText.match(expRe1);
        if (em) exp = em[1];
        results.push({
          merchant: m,
          reward: r,
          expires: exp,
          isAdded: /activated|added/i.test(ariaLabel),
        });
      }
    }

    // Strategy 3: img[alt] + parent text for reward pattern
    if (results.length === 0) {
      var imgEls = document.querySelectorAll("img[alt]");
      for (var imgEl of imgEls) {
        var alt = imgEl.getAttribute("alt")?.trim() || "";
        if (!alt || alt.length > 60) continue;
        var parent = imgEl.closest("div, a, li, section, article");
        if (!parent) continue;
        var parentText = parent.textContent?.trim() || "";
        var prm = parentText.match(rewardRe);
        if (!prm) continue;
        var pk = (alt + "|" + prm[0]).toLowerCase();
        if (seen.has(pk)) continue;
        seen.add(pk);
        var pexp = "";
        var pem = parentText.match(expRe1);
        if (pem) pexp = pem[1];
        results.push({
          merchant: alt,
          reward: prm[0].trim(),
          expires: pexp,
          isAdded: false,
        });
      }
    }

    return results;
  });

  console.log(
    `[capitalone]   Extracted ${rawOffers.length} offer(s) from page`
  );

  return rawOffers.map((o) => ({
    merchant: o.merchant,
    description: o.reward,
    expiresAt: normalizeExpDate(o.expires) || undefined,
    isAdded: o.isAdded,
    rewardType: inferRewardType(o.reward),
    rewardAmount: extractRewardAmount(o.reward),
  }));
}

/**
 * Fallback: scrape offers directly from the dashboard tiles.
 */
async function scrapeDashboardOffers(
  page: Page
): Promise<CapitalOneOffer[]> {
  const offers = await page.evaluate(() => {
    const results: {
      merchant: string;
      reward: string;
      expires: string;
    }[] = [];

    const offerEls = document.querySelectorAll(
      'div[role="button"][class*="c1-ease-dte-basic-offer"]'
    );

    for (const el of offerEls) {
      const ariaLabel = el.getAttribute("aria-label") || "";
      if (!ariaLabel) continue;

      const parts = ariaLabel.split(",").map((s) => s.trim());
      const merchant = parts[0] || "";
      const reward = parts[1] || "";
      if (!merchant || !reward) continue;

      let expires = "";
      if (ariaLabel.toLowerCase().includes("today only")) {
        expires = "Today";
      }
      // Check full element text for date patterns
      const text = el.textContent || "";
      const expMatch = text.match(
        /(?:expires?|ends?)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i
      );
      if (expMatch) expires = expMatch[1];
      const expWordMatch = text.match(
        /(?:expires?|ends?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:,?\s+\d{4})?)/i
      );
      if (expWordMatch) expires = expWordMatch[1];

      results.push({ merchant, reward, expires });
    }

    return results;
  });

  return offers.map((o) => ({
    merchant: o.merchant,
    description: o.reward,
    expiresAt: normalizeExpDate(o.expires) || undefined,
    isAdded: false,
    rewardType: inferRewardType(o.reward),
    rewardAmount: extractRewardAmount(o.reward),
  }));
}

/**
 * Normalize expiration date strings to ISO format (YYYY-MM-DD) when possible.
 */
function normalizeExpDate(dateStr: string): string {
  if (!dateStr) return "";
  if (dateStr === "Today") return "Today";
  if (dateStr === "Ending soon") return "Ending soon";

  // MM/DD/YYYY or MM/DD/YY
  const slashMatch = dateStr.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/
  );
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year =
      y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // MM/DD (no year — assume current year)
  const shortSlashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortSlashMatch) {
    const [, m, d] = shortSlashMatch;
    const year = new Date().getFullYear();
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "March 15, 2026" or "Mar 15"
  try {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) {
      const dt = new Date(parsed);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
  } catch {
    // Fall through
  }

  return dateStr;
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
  const cashMatch = description.match(
    /(\$[\d,]+(?:\.\d{2})?)\s*back/i
  );
  if (cashMatch) return cashMatch[1];

  // "Up to $X"
  const upToMatch = description.match(
    /up to\s+(\$[\d,]+(?:\.\d{2})?)/i
  );
  if (upToMatch) return upToMatch[1];

  // "Up to X% back"
  const upToPercent = description.match(/up to\s+(\d+)%/i);
  if (upToPercent) return `${upToPercent[1]}%`;

  // "Xx miles"
  const milesMatch = description.match(/(\d+)x?\s*miles?/i);
  if (milesMatch) return `${milesMatch[1]}x miles`;

  return description || undefined;
}
