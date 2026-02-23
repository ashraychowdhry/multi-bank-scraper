import type { Holding } from "@shared/types";

export interface AggregatedHolding {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPercent: number;
  institution: string;
  accountName?: string;
  children: Holding[];
  isDuplicate: boolean;
}

/** Prefer shorter, non-all-caps name (e.g. "Palantir Technologies" over "PALANTIR TECHNOLOGIES INC CL A") */
function pickBestName(holdings: Holding[]): string {
  return [...holdings]
    .map((h) => h.name)
    .sort((a, b) => {
      const aAllCaps = a === a.toUpperCase();
      const bAllCaps = b === b.toUpperCase();
      if (aAllCaps !== bAllCaps) return aAllCaps ? 1 : -1;
      return a.length - b.length;
    })[0];
}

export function aggregateHoldings(holdings: Holding[]): AggregatedHolding[] {
  const grouped = new Map<string, Holding[]>();

  for (const h of holdings) {
    const existing = grouped.get(h.ticker);
    if (existing) existing.push(h);
    else grouped.set(h.ticker, [h]);
  }

  const result: AggregatedHolding[] = [];

  for (const [ticker, children] of grouped) {
    const shares = children.reduce((s, c) => s + c.shares, 0);
    const currentValue = children.reduce((s, c) => s + c.currentValue, 0);
    const costBasis = children.reduce((s, c) => s + c.costBasis, 0);
    const gainLoss = children.reduce((s, c) => s + c.gainLoss, 0);
    const gainLossPercent = costBasis > 0 ? Math.round((gainLoss / costBasis) * 10000) / 100 : 0;

    const institutions = new Set(children.map((c) => c.institution));

    result.push({
      ticker,
      name: pickBestName(children),
      shares,
      currentPrice: children[0].currentPrice,
      currentValue,
      costBasis,
      gainLoss,
      gainLossPercent,
      institution: institutions.size === 1 ? children[0].institution : "multiple",
      accountName: children.length === 1 ? children[0].accountName : undefined,
      children,
      isDuplicate: children.length > 1,
    });
  }

  return result;
}
