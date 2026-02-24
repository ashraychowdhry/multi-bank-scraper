import type { Page } from "playwright";
import type { CapitalOneRewards, CapitalOneRewardActivity } from "../../types.js";
import { afterNavigation, dismissPopups } from "../popup-guard.js";
import type { CapitalOneAccountData } from "./accounts.js";

/**
 * Scrape rewards data from each card's rewards page.
 * URL pattern: https://myaccounts.capitalone.com/Card/{cardId}/rewards
 */
export async function scrapeRewards(
  page: Page,
  accounts: CapitalOneAccountData[]
): Promise<CapitalOneRewards[]> {
  console.log("[capitalone] Scraping rewards...");

  const allRewards: CapitalOneRewards[] = [];

  for (const account of accounts) {
    try {
      if (!account.viewAccountTestId) {
        console.log(
          `[capitalone]   No account ID for "${account.name}", skipping rewards`
        );
        continue;
      }

      const cardId = account.viewAccountTestId.replace(/^summary-/, "");
      const rewardsUrl = `https://myaccounts.capitalone.com/Card/${encodeURIComponent(cardId)}/rewards`;

      console.log(
        `[capitalone]   Navigating to rewards for "${account.name}"...`
      );
      await page.goto(rewardsUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(4000);
      await afterNavigation(page, { scraperName: "capitalone" });
      await dismissPopups(page, { scraperName: "capitalone" });

      // Check if we actually landed on a rewards page
      const currentUrl = page.url();
      if (!currentUrl.includes("/rewards")) {
        console.log(
          `[capitalone]   Redirected away from rewards page for "${account.name}", skipping`
        );
        continue;
      }

      const rewardsData = await extractRewardsData(page);

      if (rewardsData) {
        allRewards.push({
          cardName: account.name,
          lastFourDigits: account.accountNumber,
          ...rewardsData,
        });
        console.log(
          `[capitalone]   Rewards for "${account.name}": ${rewardsData.totalBalance} (${rewardsData.rewardsType})`
        );
      } else {
        console.log(
          `[capitalone]   No rewards data found for "${account.name}"`
        );
      }
    } catch (err) {
      console.warn(
        `[capitalone]   Error scraping rewards for "${account.name}":`,
        err
      );
    }
  }

  console.log(`[capitalone]   ${allRewards.length} card(s) with rewards data`);
  return allRewards;
}

async function extractRewardsData(
  page: Page
): Promise<Omit<CapitalOneRewards, "cardName" | "lastFourDigits"> | null> {
  try {
    const data = await page.evaluate(() => {
      const bodyText = document.body.textContent || "";

      // Look for rewards balance — could be miles, cash back, or points
      // Patterns: "139,555 Miles", "$1,227.26 Rewards Cash", "85,000 Points"
      let totalBalance = "";
      let totalBalanceNumeric = 0;
      let rewardsType: "miles" | "cash back" | "points" | "other" = "other";

      // Miles pattern
      const milesMatch = bodyText.match(/([\d,]+)\s*Miles?/i);
      if (milesMatch) {
        totalBalance = `${milesMatch[1]} miles`;
        totalBalanceNumeric = parseFloat(milesMatch[1].replace(/,/g, ""));
        rewardsType = "miles";
      }

      // Cash back pattern
      const cashMatch = bodyText.match(
        /\$([\d,]+(?:\.\d{2})?)\s*(?:Rewards?\s*Cash|Cash\s*Back)/i
      );
      if (cashMatch) {
        const cashVal = `$${cashMatch[1]}`;
        const cashNum = parseFloat(cashMatch[1].replace(/,/g, ""));
        if (!totalBalance || cashNum > 0) {
          // Some cards show both miles and cash — pick miles if present, else cash
          if (!milesMatch) {
            totalBalance = `${cashVal} cash back`;
            totalBalanceNumeric = cashNum;
            rewardsType = "cash back";
          }
        }
      }

      // Points pattern
      const pointsMatch = bodyText.match(/([\d,]+)\s*Points?/i);
      if (pointsMatch && !milesMatch) {
        totalBalance = `${pointsMatch[1]} points`;
        totalBalanceNumeric = parseFloat(
          pointsMatch[1].replace(/,/g, "")
        );
        rewardsType = "points";
      }

      // Try to get rewards balance from prominent heading/hero elements
      // Capital One typically shows the big number in h1/h2 or a hero section
      const headings = document.querySelectorAll("h1, h2, h3");
      for (const h of headings) {
        const text = h.textContent?.trim() || "";
        // Check for dollar amounts
        const hDollar = text.match(/^\$([\d,]+(?:\.\d{2})?)$/);
        if (hDollar && !totalBalance) {
          totalBalance = `$${hDollar[1]}`;
          totalBalanceNumeric = parseFloat(hDollar[1].replace(/,/g, ""));
          rewardsType = "cash back";
        }
        // Check for plain large numbers (miles/points)
        const hNumber = text.match(/^([\d,]+)$/);
        if (hNumber && !totalBalance) {
          const val = parseFloat(hNumber[1].replace(/,/g, ""));
          if (val > 100) {
            // Likely rewards, not something else
            totalBalance = hNumber[1];
            totalBalanceNumeric = val;
          }
        }
      }

      // Extract recent rewards activity if present
      // Look for activity items that have dates and descriptions with reward amounts
      const recentActivity: {
        date: string;
        description: string;
        amount: string;
      }[] = [];

      // Try to find activity/history table rows
      const activityItems = document.querySelectorAll(
        '[data-testid*="activity"], [data-testid*="reward"], .reward-activity-item, .rewards-history-item'
      );

      for (const item of activityItems) {
        const itemText = item.textContent || "";
        // Look for date patterns
        const dateMatch = itemText.match(
          /(\w{3}\s+\d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/
        );
        // Look for reward amount patterns
        const rewardAmtMatch = itemText.match(
          /([+-]?\s*[\d,]+\s*(?:miles?|points?)|\+?\$[\d,.]+)/i
        );

        if (dateMatch && rewardAmtMatch) {
          // Extract description — whatever text isn't the date or amount
          let desc = itemText
            .replace(dateMatch[0], "")
            .replace(rewardAmtMatch[0], "")
            .replace(/\s{2,}/g, " ")
            .trim();

          recentActivity.push({
            date: dateMatch[1],
            description: desc.slice(0, 100),
            amount: rewardAmtMatch[1].trim(),
          });
        }
      }

      // Extract category breakdown if present
      // Look for earning rate categories (e.g., "Dining 3%", "Groceries 3%")
      const categories: {
        category: string;
        rate: string;
        earned: string;
      }[] = [];

      const categoryEls = document.querySelectorAll(
        '.rewards-category, [data-testid*="category"], .earning-category'
      );

      for (const el of categoryEls) {
        const text = el.textContent?.trim() || "";
        const rateMatch = text.match(/(\d+[xX%])/);
        if (rateMatch) {
          const category = text
            .replace(rateMatch[0], "")
            .replace(/\s{2,}/g, " ")
            .trim();
          categories.push({
            category: category.slice(0, 50),
            rate: rateMatch[1],
            earned: "",
          });
        }
      }

      return {
        totalBalance,
        totalBalanceNumeric,
        rewardsType,
        recentActivity: recentActivity.length > 0 ? recentActivity : null,
        categories: categories.length > 0 ? categories : null,
      };
    });

    if (!data.totalBalance && data.totalBalanceNumeric === 0) {
      return null;
    }

    // Normalize recent activity dates
    const recentActivity: CapitalOneRewardActivity[] | undefined =
      data.recentActivity?.map((a) => ({
        date: normalizeRewardDate(a.date),
        description: a.description,
        amount: a.amount,
      }));

    return {
      rewardsType: data.rewardsType as CapitalOneRewards["rewardsType"],
      totalBalance: data.totalBalance,
      totalBalanceNumeric: data.totalBalanceNumeric,
      recentActivity: recentActivity,
      categoryBreakdown: data.categories || undefined,
    };
  } catch (err) {
    console.warn("[capitalone]   Error extracting rewards data:", err);
    return null;
  }
}

function normalizeRewardDate(dateStr: string): string {
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
