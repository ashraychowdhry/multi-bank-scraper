import type { Transaction } from "../../types.js";
import { normalizeDate, parseCSVLine } from "../utils.js";

/**
 * Parse Amex CSV export.
 *
 * Amex CSV typically has columns like:
 * Date, Description, Card Member, Account #, Amount, Extended Details,
 * Appears On Your Statement As, Address, City/State, Zip Code, Country,
 * Reference, Category
 *
 * Or a simpler format:
 * Date, Reference, Description, Amount
 *
 * This parser uses dynamic column detection from the header row.
 *
 * Note: In Amex CSV, charges are POSITIVE and credits/payments are NEGATIVE.
 * We flip the sign so charges are negative (debits) internally, matching the
 * Transaction type convention: negative = money out, positive = money in.
 */
export function parseAmexCSV(
  csv: string,
  accountName: string
): Omit<Transaction, "institution">[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length <= 1) return [];

  // Find the header line
  const headerIdx = lines.findIndex(
    (l) =>
      l.toLowerCase().includes("date") &&
      (l.toLowerCase().includes("description") ||
        l.toLowerCase().includes("amount"))
  );
  if (headerIdx === -1) {
    console.warn("[amex] Could not identify CSV header row.");
    return [];
  }

  const header = parseCSVLine(lines[headerIdx]).map((h) =>
    h.trim().toLowerCase()
  );

  // Find column indices dynamically
  const dateCol = header.findIndex((h) => h === "date");
  const descCol = header.findIndex(
    (h) => h === "description" || h === "appears on your statement as"
  );
  const amountCol = header.findIndex((h) => h === "amount");
  const categoryCol = header.findIndex(
    (h) => h === "category" || h === "type"
  );
  const extendedCol = header.findIndex((h) => h === "extended details");

  if (dateCol === -1 || amountCol === -1) {
    console.warn("[amex] Missing required CSV columns (date, amount).");
    return [];
  }

  const transactions: Omit<Transaction, "institution">[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < Math.max(dateCol, amountCol) + 1) continue;

    const rawDate = cols[dateCol]?.trim();
    if (!rawDate) continue;

    // Description: prefer "Description" column, fall back to "Appears On Your Statement As"
    let description = descCol >= 0 ? cols[descCol]?.trim() : "";
    if (!description && extendedCol >= 0) {
      description = cols[extendedCol]?.trim() || "";
    }
    description = (description || "").replace(/\s{2,}/g, " ");

    const amountStr = cols[amountCol]?.trim();
    if (!amountStr) continue;

    const rawAmount =
      parseFloat(amountStr.replace(/[$,]/g, "").replace(/\u2212/g, "-")) || 0;

    // Flip sign: Amex CSV has charges as positive, payments as negative
    // Our convention: charges = negative (money out), payments = positive (money in)
    const amount = -rawAmount;

    const category =
      categoryCol >= 0 ? cols[categoryCol]?.trim() || undefined : undefined;

    transactions.push({
      date: normalizeDate(rawDate),
      description,
      amount,
      category: category || classifyTransaction(description),
      isPending: false, // CSV only contains posted transactions
      accountName,
    });
  }

  return transactions;
}

function classifyTransaction(description: string): string | undefined {
  const d = description.toLowerCase();
  if (
    d.includes("payment") &&
    (d.includes("thank you") || d.includes("received"))
  )
    return "Payment";
  if (d.includes("autopay")) return "Payment";
  if (d.includes("credit") && d.includes("statement")) return "Credit";
  if (d.includes("refund") || d.includes("return")) return "Refund";
  return undefined;
}
