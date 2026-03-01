import type { Page } from "playwright";
import type { AmexRewards } from "../../types.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";

const REWARDS_URL = "https://global.americanexpress.com/rewards";
const REWARDS_SUMMARY_URL =
  "https://global.americanexpress.com/rewards/summary";

/**
 * Scrape Membership Rewards points.
 *
 * Strategy:
 * 1. Try /rewards — has data-testid="desktop-tile" with Available Points
 * 2. Fallback to /rewards/summary — has H3/H4 balance + activity table
 */
export async function scrapeRewards(
  page: Page,
  cardName: string
): Promise<AmexRewards | null> {
  console.log("[amex] Scraping Membership Rewards...");

  // Try the rewards dashboard first (more reliable data-testid elements)
  let result = await tryRewardsDashboard(page, cardName);
  if (result) return result;

  // Fallback to the summary page
  result = await tryRewardsSummary(page, cardName);
  return result;
}

async function tryRewardsDashboard(
  page: Page,
  cardName: string
): Promise<AmexRewards | null> {
  try {
    await page.goto(REWARDS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await afterNavigation(page, { scraperName: "amex" });
    await page.waitForTimeout(5000);
    await dismissPopups(page, { scraperName: "amex" });

    const url = page.url();
    if (url.includes("login") || url.includes("challenge")) {
      console.log("[amex]   Redirected to login from rewards page.");
      return null;
    }

    // Wait for the desktop tile with "Available Points"
    const tile = page.locator('[data-testid="desktop-tile"]').first();
    const tileVisible = await tile
      .waitFor({ timeout: 12000 })
      .then(() => true)
      .catch(() => false);

    if (!tileVisible) {
      console.log("[amex]   Rewards dashboard tiles did not load.");
      return null;
    }

    // Extra wait for all tiles to render
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      let availablePoints = 0;
      let pointsEarnedThisYear = 0;
      let pointsUsedThisYear = 0;

      // The desktop tiles contain structured data:
      // Tile 1: "Available Points...XX,XXX"
      // Tile 2: "Points Earned in 2026...X,XXX"
      // Tile 3: "Saved with Amex Offers...$XX.XX"
      const tiles = document.querySelectorAll('[data-testid="desktop-tile"]');
      for (const tile of tiles) {
        const text = tile.textContent || "";

        if (text.includes("Available Points")) {
          // Extract the number after "Available Points"
          const match = text.match(/Available Points[\s\S]*?([\d,]+)/);
          if (match) {
            availablePoints = parseInt(match[1].replace(/,/g, ""), 10);
          }
        }

        if (text.includes("Points Earned in")) {
          const match = text.match(/Points Earned in \d{4}[\s\S]*?([\d,]+)/);
          if (match) {
            pointsEarnedThisYear = parseInt(
              match[1].replace(/,/g, ""),
              10
            );
          }
        }
      }

      // Also check for the hero/header balance as a fallback
      if (availablePoints === 0) {
        // H3 "Membership Rewards® Points" + sibling H4 with number
        const h3s = document.querySelectorAll("h3");
        for (const h3 of h3s) {
          const text = h3.textContent?.trim() || "";
          if (text.includes("Membership Rewards")) {
            const parent = h3.parentElement;
            if (parent) {
              const h4 = parent.querySelector("h4");
              if (h4) {
                const numText =
                  h4.textContent?.trim().replace(/,/g, "") || "";
                const num = parseInt(numText, 10);
                if (!isNaN(num)) availablePoints = num;
              }
            }
            break;
          }
        }
      }

      // Check "Points Used" section if visible (may be on /rewards or /rewards/summary)
      const bodyText = document.body.textContent || "";
      const usedMatch = bodyText.match(
        /Points Used in \d{4}[\s\S]{0,200}?([\d,]+)/
      );
      if (usedMatch) {
        pointsUsedThisYear = parseInt(usedMatch[1].replace(/,/g, ""), 10);
      }

      return { availablePoints, pointsEarnedThisYear, pointsUsedThisYear };
    });

    if (data.availablePoints === 0) {
      console.log("[amex]   Could not extract points from rewards dashboard.");
      return null;
    }

    console.log(
      `[amex]   Membership Rewards: ${data.availablePoints.toLocaleString()} points` +
        (data.pointsEarnedThisYear
          ? ` (earned ${data.pointsEarnedThisYear.toLocaleString()} this year)`
          : "")
    );

    return {
      cardName,
      availablePoints: data.availablePoints,
      pointsEarnedThisYear: data.pointsEarnedThisYear,
      pointsUsedThisYear: data.pointsUsedThisYear,
    };
  } catch (err) {
    console.warn("[amex]   Error on rewards dashboard:", err);
    return null;
  }
}

async function tryRewardsSummary(
  page: Page,
  cardName: string
): Promise<AmexRewards | null> {
  try {
    console.log("[amex]   Trying rewards summary page...");
    await page.goto(REWARDS_SUMMARY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await afterNavigation(page, { scraperName: "amex" });
    await page.waitForTimeout(6000);

    const url = page.url();
    if (url.includes("login") || url.includes("challenge")) {
      return null;
    }

    // Wait for the MR heading
    const mrHeading = page
      .locator('h3:has-text("Membership Rewards")')
      .first();
    await mrHeading.waitFor({ timeout: 10000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const bodyText = document.body.textContent || "";

      // Points balance from H3/H4 pattern
      let availablePoints = 0;
      const h3s = document.querySelectorAll("h3");
      for (const h3 of h3s) {
        const text = h3.textContent?.trim() || "";
        if (text.includes("Membership Rewards")) {
          const parent = h3.parentElement;
          if (parent) {
            const h4 = parent.querySelector("h4");
            if (h4) {
              const numText =
                h4.textContent?.trim().replace(/,/g, "") || "";
              const num = parseInt(numText, 10);
              if (!isNaN(num)) availablePoints = num;
            }
          }
          break;
        }
      }

      // Points earned/used
      let pointsEarnedThisYear = 0;
      const earnedMatch = bodyText.match(
        /Points Earned in \d{4}[\s\S]{0,200}?([\d,]+)/
      );
      if (earnedMatch) {
        pointsEarnedThisYear = parseInt(
          earnedMatch[1].replace(/,/g, ""),
          10
        );
      }

      let pointsUsedThisYear = 0;
      const usedMatch = bodyText.match(
        /Points Used in \d{4}[\s\S]{0,200}?([\d,]+)/
      );
      if (usedMatch) {
        pointsUsedThisYear = parseInt(usedMatch[1].replace(/,/g, ""), 10);
      }

      // Activity table
      const activity: { date: string; description: string; points: string }[] =
        [];
      const rows = document.querySelectorAll("tbody tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          const date = cells[0]?.textContent?.trim() || "";
          const desc = cells[1]?.textContent?.trim() || "";
          const pts = cells[2]?.textContent?.trim() || "";
          if (date && desc) {
            activity.push({ date, description: desc, points: pts });
          }
        }
      }

      return {
        availablePoints,
        pointsEarnedThisYear,
        pointsUsedThisYear,
        activity,
      };
    });

    if (data.availablePoints === 0) {
      console.log("[amex]   Could not extract points from summary page.");
      return null;
    }

    console.log(
      `[amex]   Membership Rewards: ${data.availablePoints.toLocaleString()} points` +
        (data.pointsEarnedThisYear
          ? ` (earned ${data.pointsEarnedThisYear.toLocaleString()} this year)`
          : "")
    );
    if (data.activity.length > 0) {
      console.log(`[amex]   ${data.activity.length} recent activity item(s)`);
    }

    return {
      cardName,
      availablePoints: data.availablePoints,
      pointsEarnedThisYear: data.pointsEarnedThisYear,
      pointsUsedThisYear: data.pointsUsedThisYear,
      recentActivity:
        data.activity.length > 0
          ? data.activity.map((a) => ({
              date: normalizeDate(a.date),
              description: a.description,
              points: a.points,
            }))
          : undefined,
    };
  } catch (err) {
    console.warn("[amex]   Error on rewards summary:", err);
    return null;
  }
}

function normalizeDate(dateStr: string): string {
  try {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  } catch {
    // Fall through
  }
  return dateStr;
}
