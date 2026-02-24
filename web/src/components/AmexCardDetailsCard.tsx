import type { AmexCreditCardDetails } from "@shared/types";
import { formatCurrency } from "../utils/format";

export function AmexCardDetailsCard({ data }: { data: AmexCreditCardDetails }) {
  return (
    <div className="card-details-card">
      <div className="interest-header">
        <h3>Credit Card Details</h3>
        {data.paymentDueDate && (
          <span className="due-date-badge">Due {data.paymentDueDate}</span>
        )}
      </div>
      <div className="card-details-stats">
        <div className="card-details-stat">
          <span className="card-details-stat-label">Statement Balance</span>
          <span className="card-details-stat-value">{formatCurrency(data.statementBalance)}</span>
        </div>
        <div className="card-details-stat">
          <span className="card-details-stat-label">Total Balance</span>
          <span className="card-details-stat-value">{formatCurrency(data.totalBalance)}</span>
        </div>
        {data.minimumPayment > 0 && (
          <div className="card-details-stat">
            <span className="card-details-stat-label">Minimum Payment</span>
            <span className="card-details-stat-value negative">{formatCurrency(data.minimumPayment)}</span>
          </div>
        )}
        {data.availableCredit > 0 && (
          <div className="card-details-stat">
            <span className="card-details-stat-label">Available Credit</span>
            <span className="card-details-stat-value">{formatCurrency(data.availableCredit)}</span>
          </div>
        )}
        {data.creditLimit > 0 && (
          <div className="card-details-stat">
            <span className="card-details-stat-label">Credit Limit</span>
            <span className="card-details-stat-value">{formatCurrency(data.creditLimit)}</span>
          </div>
        )}
        {data.lastPaymentAmount != null && data.lastPaymentAmount > 0 && (
          <div className="card-details-stat">
            <span className="card-details-stat-label">
              Last Payment{data.lastPaymentDate ? ` (${data.lastPaymentDate})` : ""}
            </span>
            <span className="card-details-stat-value positive">{formatCurrency(data.lastPaymentAmount)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
