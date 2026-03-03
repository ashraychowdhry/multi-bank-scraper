import { parseCSVLine } from "../utils.js";

export interface FidelityCSVPosition {
  accountNumber: string;
  accountName: string;
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  costBasis: number;
  costBasisPerShare: number;
  gainLoss: number;
  gainLossPercent: number;
}

function parseAmount(str: string): number {
  return parseFloat(str.replace(/[$,+%]/g, "").trim()) || 0;
}

export function parseFidelityPositionsCSV(csv: string): FidelityCSVPosition[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length <= 1) return [];

  // Find header line — Fidelity CSVs may have a disclaimer preamble
  let headerIdx = lines.findIndex(
    (l) => l.includes("Account Number") && l.includes("Symbol")
  );
  if (headerIdx === -1) headerIdx = 0;

  const positions: FidelityCSVPosition[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 15) continue;

    const accountNumber = cols[0].trim();
    const accountName = cols[1].trim();
    const ticker = cols[2].trim().replace(/\*+$/, ""); // Strip Fidelity footnote markers (e.g., "SPAXX**" → "SPAXX")
    const description = cols[3].trim();

    // Skip non-position rows
    if (!ticker || !accountNumber) continue;
    if (ticker === "Pending Activity") continue;
    // Skip disclaimer/footer rows (account number contains non-numeric chars besides dashes)
    if (!/^[\w-]+$/.test(accountNumber)) continue;

    const quantity = parseAmount(cols[4]);
    const lastPrice = parseAmount(cols[5]);
    // cols[6] = Last Price Change
    const currentValue = parseAmount(cols[7]);
    // cols[8] = Today's Gain/Loss Dollar
    // cols[9] = Today's Gain/Loss Percent
    const totalGainLossDollar = parseAmount(cols[10]);
    const totalGainLossPercent = parseAmount(cols[11]);
    // cols[12] = Percent Of Account
    const costBasis = parseAmount(cols[13]);
    const costBasisPerShare = parseAmount(cols[14]);

    positions.push({
      accountNumber,
      accountName,
      ticker,
      name: description,
      shares: quantity,
      currentPrice: lastPrice,
      currentValue,
      costBasis,
      costBasisPerShare,
      gainLoss: totalGainLossDollar,
      gainLossPercent: totalGainLossPercent,
    });
  }

  return positions;
}

