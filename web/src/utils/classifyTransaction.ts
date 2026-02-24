import type { Transaction } from "@shared/types";

const TRADE_SUFFIXES = [
  " Market Buy", " Market Sell", " Limit Buy", " Limit Sell",
  " Stop Buy", " Stop Sell", " Stop Limit Buy", " Stop Limit Sell",
];

/**
 * Normalize a transaction's category. Uses the existing category field
 * if set (Robinhood), otherwise classifies from description (Fidelity, etc).
 */
export function classifyTransaction(t: Transaction): string {
  if (t.category) return t.category;

  const d = t.description.toLowerCase();
  if (d.includes("market buy") || d.includes("limit buy") || d.includes("you bought")) return "buy";
  if (d.includes("market sell") || d.includes("limit sell") || d.includes("you sold")) return "sell";
  if (d.includes("dividend")) return "dividend";
  if (d.includes("reinvestment")) return "reinvestment";
  if (d.includes("contribution")) return "contribution";
  if (d.includes("deposit")) return "deposit";
  if (d.includes("withdrawal")) return "withdrawal";
  if (d.includes("stock lending")) return "stock_lending";
  if (d.includes("interest")) return "interest";
  return "other";
}

/** True if the transaction is a buy or sell trade */
export function isTrade(t: Transaction): boolean {
  const cat = classifyTransaction(t);
  return cat === "buy" || cat === "sell";
}

/**
 * Extract the stock/company name from a trade description.
 * - Robinhood: "Flutter Entertainment Market Buy" → "Flutter Entertainment"
 * - Fidelity: "YOU BOUGHT APPLE INC (AAPL) (Cash)" → "Apple Inc"
 */
export function extractStockName(t: Transaction): string {
  const desc = t.description;

  // Try stripping known trade suffixes (Robinhood pattern)
  for (const suffix of TRADE_SUFFIXES) {
    if (desc.endsWith(suffix)) {
      return desc.slice(0, -suffix.length).trim();
    }
    // Case-insensitive check
    if (desc.toLowerCase().endsWith(suffix.toLowerCase())) {
      return desc.slice(0, -suffix.length).trim();
    }
  }

  // Fidelity pattern: "YOU BOUGHT COMPANY NAME (TICKER) (Cash)"
  const fidelityMatch = desc.match(/(?:YOU BOUGHT|YOU SOLD)\s+(.+?)\s+\([A-Z]+\)/i);
  if (fidelityMatch) {
    // Title-case the name
    return fidelityMatch[1]
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Fallback: return description minus any trailing IPO/Split markers
  return desc
    .replace(/\s+(IPO Buy|Forward Split|Reverse Split)$/i, "")
    .trim();
}

/**
 * Try to extract a ticker symbol from the description.
 * Fidelity includes (TICKER) in descriptions; Robinhood does not.
 */
export function extractTicker(t: Transaction): string | null {
  const match = t.description.match(/\(([A-Z]{1,5})\)/);
  return match ? match[1] : null;
}
