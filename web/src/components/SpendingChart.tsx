import type { ChaseTransaction } from "../types";
import { formatCurrency, formatMonthLabel } from "../utils/format";

interface MonthlyTotal {
  label: string;
  month: string;
  income: number;
  spending: number;
}

function computeMonthlyTotals(transactions: ChaseTransaction[]): MonthlyTotal[] {
  const map = new Map<string, { income: number; spending: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const entry = map.get(month) || { income: 0, spending: 0 };
    if (t.amount >= 0) entry.income += t.amount;
    else entry.spending += t.amount;
    map.set(month, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({
      label: formatMonthLabel(month),
      month,
      ...vals,
    }));
}

export function SpendingChart({ transactions }: { transactions: ChaseTransaction[] }) {
  const data = computeMonthlyTotals(transactions);
  const maxVal = Math.max(
    ...data.flatMap((m) => [m.income, Math.abs(m.spending)]),
    1
  );

  return (
    <div className="chart">
      <div className="chart-bars">
        {data.map((month) => (
          <div key={month.month} className="chart-month">
            <div className="bars">
              <div
                className="bar income"
                style={{ height: `${(month.income / maxVal) * 100}%` }}
                title={`Income: ${formatCurrency(month.income)}`}
              />
              <div
                className="bar spending"
                style={{ height: `${(Math.abs(month.spending) / maxVal) * 100}%` }}
                title={`Spending: ${formatCurrency(Math.abs(month.spending))}`}
              />
            </div>
            <span className="month-label">{month.label}</span>
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-dot income" /> Income
        </span>
        <span className="legend-item">
          <span className="legend-dot spending" /> Spending
        </span>
      </div>
    </div>
  );
}
