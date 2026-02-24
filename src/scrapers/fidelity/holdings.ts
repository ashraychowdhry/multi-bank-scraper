import * as fs from "node:fs";
import type { Page } from "playwright";
import type { Holding } from "../../types.js";
import { afterNavigation } from "../popup-guard.js";
import { parseFidelityPositionsCSV, type FidelityCSVPosition } from "./csv.js";

// Internal type: Holding + account info for account aggregation
export type FidelityHoldingData = Omit<Holding, "institution"> & {
  accountNumber: string;
  accountName: string;
};

const POSITIONS_URL =
  "https://digital.fidelity.com/ftgw/digital/portfolio/positions";

export async function scrapeHoldings(
  page: Page
): Promise<FidelityHoldingData[]> {
  console.log("[fidelity] Navigating to positions page...");

  await page.goto(POSITIONS_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(3000);
  await afterNavigation(page, { scraperName: "fidelity" });

  const csvContent = await downloadPositionsCSV(page);
  if (!csvContent) {
    console.warn("[fidelity] Could not download positions CSV.");
    return [];
  }

  const positions = parseFidelityPositionsCSV(csvContent);
  console.log(`[fidelity] Parsed ${positions.length} positions from CSV.`);

  return positions.map(csvToHolding);
}

function csvToHolding(p: FidelityCSVPosition): FidelityHoldingData {
  return {
    ticker: p.ticker,
    name: p.name,
    shares: p.shares,
    currentPrice: p.currentPrice,
    currentValue: p.currentValue,
    costBasis: p.costBasis,
    gainLoss: p.gainLoss,
    gainLossPercent: p.gainLossPercent,
    accountNumber: p.accountNumber,
    accountName: p.accountName,
  };
}

async function downloadPositionsCSV(page: Page): Promise<string | null> {
  try {
    // Fidelity positions page: click "Available Actions" → "Download" menuitem
    const actionsBtn = page.locator(
      'button:has-text("Available Actions")'
    );
    if (await actionsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await actionsBtn.click();
      await page.waitForTimeout(1000);

      const downloadBtn = page.locator("#kebabmenuitem-download");
      if (
        await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          downloadBtn.click(),
        ]);

        const filePath = await download.path();
        if (filePath) {
          const content = fs.readFileSync(filePath, "utf-8");
          console.log(
            `[fidelity] Downloaded positions CSV (${content.length} bytes).`
          );
          return content;
        }
      }
    }

    // Fallback: try "Download Positions" label (old UI)
    const oldBtn = page.getByLabel("Download Positions");
    if (await oldBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        oldBtn.click(),
      ]);

      const filePath = await download.path();
      if (filePath) {
        const content = fs.readFileSync(filePath, "utf-8");
        console.log(
          `[fidelity] Downloaded positions CSV (${content.length} bytes).`
        );
        return content;
      }
    }

    console.warn("[fidelity] No download button found on positions page.");
    return null;
  } catch (err) {
    console.warn("[fidelity] Positions CSV download failed:", err);
    return null;
  }
}
