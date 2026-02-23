import type { AccountType } from "../../types.js";
import type { FidelityHoldingData } from "./holdings.js";

// Internal type without institution field (added by FidelityScraper.scrape)
export type FidelityAccountData = {
  name: string;
  type: AccountType;
  currentBalance: number;
  accountNumber: string;
};

export function inferFidelityAccountType(name: string): AccountType {
  const lower = name.toLowerCase();
  if (lower.includes("individual") || lower.includes("brokerage") || lower.includes("tod"))
    return "brokerage";
  if (lower.includes("roth") || lower.includes("ira")) return "investment";
  if (lower.includes("401k") || lower.includes("401(k)")) return "investment";
  if (lower.includes("cash management") || lower.includes("cma")) return "checking";
  if (lower.includes("hsa")) return "savings";
  if (lower.includes("credit")) return "credit";
  return "investment";
}

/**
 * Build account list by aggregating holdings per account from the positions CSV.
 * The positions CSV is the most reliable data source — it includes account number,
 * account name, and per-position values that we aggregate into total balances.
 */
export function buildAccountsFromCSV(
  holdings: FidelityHoldingData[]
): FidelityAccountData[] {
  const accountMap = new Map<string, FidelityAccountData>();

  for (const h of holdings) {
    const existing = accountMap.get(h.accountNumber);
    if (existing) {
      existing.currentBalance += h.currentValue;
    } else {
      accountMap.set(h.accountNumber, {
        name: h.accountName,
        type: inferFidelityAccountType(h.accountName),
        currentBalance: h.currentValue,
        accountNumber: h.accountNumber,
      });
    }
  }

  for (const account of accountMap.values()) {
    account.currentBalance = Math.round(account.currentBalance * 100) / 100;
  }

  return Array.from(accountMap.values());
}
