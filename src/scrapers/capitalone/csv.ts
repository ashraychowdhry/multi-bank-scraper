import type { Transaction } from "../../types.js";
import { normalizeDate, parseCSVLine } from "../utils.js";

/**
 * Parse Capital One CSV export.
 *
 * Capital One CSV typically has columns:
 * Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
 *
 * Key difference from Amex: Debit and Credit are in separate columns.
 * - Debit column has charges (money out)
 * - Credit column has payments/credits (money in)
 *
 * Some formats may have a single "Amount" column instead, where
 * charges are positive and credits are negative.
 */
export function parseCapitalOneCSV(
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
        l.toLowerCase().includes("amount") ||
        l.toLowerCase().includes("debit"))
  );
  if (headerIdx === -1) {
    console.warn("[capitalone] Could not identify CSV header row.");
    return [];
  }

  const header = parseCSVLine(lines[headerIdx]).map((h) =>
    h.trim().toLowerCase()
  );

  // Find column indices dynamically
  const dateCol = header.findIndex(
    (h) => h === "transaction date" || h === "date" || h === "posted date"
  );
  const descCol = header.findIndex(
    (h) => h === "description" || h === "merchant" || h === "name"
  );
  const categoryCol = header.findIndex(
    (h) => h === "category" || h === "type"
  );

  // Capital One may use separate Debit/Credit columns OR a single Amount column
  const debitCol = header.findIndex((h) => h === "debit");
  const creditCol = header.findIndex((h) => h === "credit");
  const amountCol = header.findIndex((h) => h === "amount");

  if (dateCol === -1 || (amountCol === -1 && debitCol === -1)) {
    console.warn("[capitalone] Missing required CSV columns (date, amount/debit).");
    return [];
  }

  const transactions: Omit<Transaction, "institution">[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < Math.max(dateCol, descCol, amountCol, debitCol) + 1)
      continue;

    const rawDate = cols[dateCol]?.trim();
    if (!rawDate) continue;

    let description = descCol >= 0 ? cols[descCol]?.trim() : "";
    description = (description || "").replace(/\s{2,}/g, " ");

    let amount: number;

    if (debitCol >= 0 && creditCol >= 0) {
      // Separate Debit/Credit columns
      const debitStr = cols[debitCol]?.trim();
      const creditStr = cols[creditCol]?.trim();
      const debitAmt =
        parseFloat(
          (debitStr || "").replace(/[$,]/g, "").replace(/\u2212/g, "-")
        ) || 0;
      const creditAmt =
        parseFloat(
          (creditStr || "").replace(/[$,]/g, "").replace(/\u2212/g, "-")
        ) || 0;

      // Debit = money out (negative), Credit = money in (positive)
      if (debitAmt > 0) {
        amount = -debitAmt;
      } else if (creditAmt > 0) {
        amount = creditAmt;
      } else {
        amount = 0;
      }
    } else {
      // Single Amount column
      const amountStr = cols[amountCol]?.trim();
      if (!amountStr) continue;
      const rawAmount =
        parseFloat(
          amountStr.replace(/[$,]/g, "").replace(/\u2212/g, "-")
        ) || 0;
      // Capital One single-column: charges positive, credits negative
      // Flip sign: charges = negative (money out)
      amount = -rawAmount;
    }

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
