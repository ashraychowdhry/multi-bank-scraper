import type { Page } from "playwright";
import type { Transaction } from "../../types.js";
import { parseBalance } from "../utils.js";
import { afterNavigation } from "../popup-guard.js";

function classifyFidelityTransaction(description: string): string | undefined {
  const d = description.toLowerCase();
  if (d.includes("you bought") || d.includes("bought")) return "buy";
  if (d.includes("you sold") || d.includes("sold")) return "sell";
  if (d.includes("dividend")) return "dividend";
  if (d.includes("reinvestment")) return "reinvestment";
  if (d.includes("contribution")) return "contribution";
  if (d.includes("deposit")) return "deposit";
  if (d.includes("withdrawal")) return "withdrawal";
  if (d.includes("interest")) return "interest";
  if (d.includes("fee")) return "fee";
  return undefined;
}

const ACTIVITY_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/activity";

/**
 * Scrape transactions from Fidelity's Activity & Orders page.
 * Clicks "History" filter, then scrapes the DOM rows.
 */
export async function scrapeTransactions(
  page: Page
): Promise<Omit<Transaction, "institution">[]> {
  console.log("[fidelity] Navigating to activity page...");

  await page.goto(ACTIVITY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await afterNavigation(page, { scraperName: "fidelity" });
  await page.waitForTimeout(4000);

  // Click "History" filter button to show historical transactions
  const historyBtn = page.locator('button:has-text("History")').first();
  if (await historyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await historyBtn.click();
    await page.waitForTimeout(3000);
    console.log("[fidelity] Switched to History view.");
  }

  return await scrapeHistoryRows(page);
}

/**
 * Scrape history rows from the DOM.
 * Each row is a div with concatenated text like:
 *   "Feb-13-2026EMPLOYER 401(K) ***1234Contributions+$X,XXX.XX"
 *
 * Strategy: find all leaf-level divs that start with a date pattern.
 */
async function scrapeHistoryRows(
  page: Page
): Promise<Omit<Transaction, "institution">[]> {
  const rows = await page.evaluate(() => {
    const DATE_RE =
      /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{1,2}-\d{4})/;
    const AMOUNT_RE = /([+-]?\$[\d,.]+)$/;
    const ACCT_RE = /^(.+?\*{3}\d{4})(.*)/;

    const results: Array<{
      date: string;
      account: string;
      description: string;
      amount: string;
    }> = [];

    // Walk all elements and find those whose OWN text starts with a date
    // This avoids matching parent containers
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as HTMLElement;
          const text = el.textContent?.trim() || "";
          // Must start with a date pattern
          if (!DATE_RE.test(text)) return NodeFilter.FILTER_SKIP;
          // Must be a leaf-ish element (no child that also starts with a date)
          const childWithDate = el.querySelector("*");
          if (childWithDate) {
            const childText = childWithDate.textContent?.trim() || "";
            if (DATE_RE.test(childText) && childText.length < text.length) {
              return NodeFilter.FILTER_SKIP;
            }
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    // Fallback: just find all divs that contain exactly one transaction
    // Use a different approach — get direct children of the activity list
    const allDivs = document.querySelectorAll("div");
    const seen = new Set<string>();

    for (const div of allDivs) {
      const text = div.textContent?.trim() || "";
      if (!DATE_RE.test(text)) continue;

      // Skip if any child div also starts with a date (we want leaf elements)
      let hasChildWithDate = false;
      for (const child of div.children) {
        const childText = child.textContent?.trim() || "";
        if (DATE_RE.test(childText) && childText !== text) {
          hasChildWithDate = true;
          break;
        }
      }
      if (hasChildWithDate) continue;

      // Check this is a single-transaction row (should have exactly 1 date)
      const dateMatches = text.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{1,2}-\d{4}/g
      );
      if (!dateMatches || dateMatches.length !== 1) continue;

      const dateMatch = text.match(DATE_RE);
      if (!dateMatch) continue;

      const date = dateMatch[1];
      const rest = text.slice(date.length);

      // Deduplicate by full text
      if (seen.has(text)) continue;
      seen.add(text);

      // Extract amount from end
      const amountMatch = rest.match(AMOUNT_RE);
      const amount = amountMatch ? amountMatch[1] : "";

      // Middle part is account + description
      const middle = amountMatch
        ? rest.slice(0, rest.lastIndexOf(amountMatch[1])).trim()
        : rest.trim();

      // Split account from description using *** pattern
      const acctMatch = middle.match(ACCT_RE);
      let account = "";
      let description = middle;

      if (acctMatch) {
        account = acctMatch[1].trim();
        description = acctMatch[2].trim();
      }

      if (date && (amount || description)) {
        results.push({ date, account, description, amount });
      }
    }

    return results;
  });

  console.log(`[fidelity] Scraped ${rows.length} history rows from DOM.`);

  return rows.map((r) => {
    // Parse Fidelity date format "Feb-13-2026" → normalizeDate expects "Feb 13, 2026"
    const dateStr = r.date
      .replace(/-(\d{1,2})-/, " $1, ")
      .replace(/^(\w+)/, "$1");

    // Determine date — format is "Mon-DD-YYYY"
    const parts = r.date.split("-");
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04",
      May: "05", Jun: "06", Jul: "07", Aug: "08",
      Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const isoDate = `${parts[2]}-${months[parts[0]] || "01"}-${parts[1].padStart(2, "0")}`;

    const description = r.description || "Unknown";
    return {
      date: isoDate,
      description,
      amount: parseBalance(r.amount),
      category: classifyFidelityTransaction(description),
      isPending: false,
      accountName: r.account,
    };
  });
}
