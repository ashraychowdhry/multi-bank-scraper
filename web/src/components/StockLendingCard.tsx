import type { StockLendingIncome } from "@shared/types";
import { formatCurrency } from "../utils/format";

export function StockLendingCard({ data }: { data: StockLendingIncome }) {
  return (
    <div className="lending-card">
      <h3>Stock Lending Income</h3>
      <div className="lending-summary">
        <div className="lending-stat">
          <span className="lending-stat-label">Last Month</span>
          <span className="lending-stat-value positive">
            {formatCurrency(data.lastMonth)}
          </span>
        </div>
        <div className="lending-stat">
          <span className="lending-stat-label">Total Earned</span>
          <span className="lending-stat-value positive">
            {formatCurrency(data.total)}
          </span>
        </div>
      </div>
      {data.stocksOnLoan.length > 0 && (
        <div className="lending-stocks">
          <span className="lending-stocks-label">
            {data.stocksOnLoan.length} stocks on loan
          </span>
          <div className="lending-tickers">
            {data.stocksOnLoan.map((s) => (
              <span key={s.ticker} className="lending-ticker" title={`${s.name} — ${s.shares} shares`}>
                {s.ticker}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
