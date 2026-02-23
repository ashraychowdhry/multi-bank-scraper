export function parseBalance(str: string | undefined): number {
  if (!str) return 0;
  return (
    parseFloat(str.replace(/[$,]/g, "").replace(/\u2212/g, "-").trim()) || 0
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
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
