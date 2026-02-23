import type { Transaction } from "../../types.js";
import { normalizeDate, parseCSVLine } from "../utils.js";

export function parseChaseCSV(
  csv: string,
  accountName: string
): Omit<Transaction, "institution">[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length <= 1) return [];

  const header = lines[0].toLowerCase();
  const isCredit = header.includes("category");
  const transactions: Omit<Transaction, "institution">[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;

    if (isCredit) {
      transactions.push({
        date: normalizeDate(cols[0]),
        description: cols[2].trim().replace(/\s{2,}/g, " "),
        amount: parseFloat(cols[5]) || 0,
        category: cols[3].trim() || undefined,
        isPending: false,
        accountName,
      });
    } else {
      transactions.push({
        date: normalizeDate(cols[1]),
        description: cols[2].trim().replace(/\s{2,}/g, " "),
        amount: parseFloat(cols[3]) || 0,
        category: undefined,
        isPending: false,
        accountName,
      });
    }
  }

  return transactions;
}
