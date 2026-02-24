import type { CashInterest } from "@shared/types";
import { formatCurrency } from "../utils/format";

export function CashInterestCard({ data }: { data: CashInterest }) {
  return (
    <div className="interest-card">
      <div className="interest-header">
        <h3>Cash Interest</h3>
        <span className="interest-apy">{data.apy}% APY</span>
      </div>
      <div className="interest-stats">
        <div className="interest-stat">
          <span className="interest-stat-label">Accrued This Month</span>
          <span className="interest-stat-value positive">
            {formatCurrency(data.interestAccruedThisMonth)}
          </span>
        </div>
        <div className="interest-stat">
          <span className="interest-stat-label">Lifetime Interest Earned</span>
          <span className="interest-stat-value positive">
            {formatCurrency(data.lifetimeInterestPaid)}
          </span>
        </div>
        <div className="interest-stat">
          <span className="interest-stat-label">Cash Earning Interest</span>
          <span className="interest-stat-value">
            {formatCurrency(data.cashEarningInterest)}
          </span>
        </div>
      </div>
    </div>
  );
}
