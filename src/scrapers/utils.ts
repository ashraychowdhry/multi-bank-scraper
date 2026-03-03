export function parseBalance(str: string | undefined): number {
  if (!str) return 0;
  return (
    parseFloat(str.replace(/[+$,]/g, "").replace(/\u2212/g, "-").trim()) || 0
  );
}

export function normalizeDate(dateStr: string): string {
  const trimmed = dateStr.trim();

  // MM/DD/YYYY → YYYY-MM-DD (CSV format)
  const slashParts = trimmed.split("/");
  if (slashParts.length === 3) {
    return `${slashParts[2]}-${slashParts[0].padStart(2, "0")}-${slashParts[1].padStart(2, "0")}`;
  }

  // "Feb 20, 2026" → YYYY-MM-DD (dashboard format)
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return trimmed;
}

export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export function classifyTransaction(description: string): string | undefined {
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
