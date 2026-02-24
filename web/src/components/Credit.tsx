import type { ScrapeResult } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { creditAccounts, sumBalance, transactionsForAccountTypes, groupBy } from "../utils/accountHelpers";
import { AccountCard } from "./AccountCard";
import { AmexCardDetailsCard } from "./AmexCardDetailsCard";

export function Credit({ data }: { data: ScrapeResult }) {
  const cards = creditAccounts(data.accounts);
  const totalDebt = sumBalance(cards);
  const creditTxns = transactionsForAccountTypes(data.transactions, data.accounts, ["credit"]);

  // Credit utilization (from amexCardDetails if available)
  const amex = data.amexCardDetails;
  const creditLimit = amex?.creditLimit || 0;
  const utilization = creditLimit > 0 ? (totalDebt / creditLimit) * 100 : 0;

  const accountsByInstitution = groupBy(cards, (a) => a.institution);

  const recentCharges = [...creditTxns]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);

  const thisMonthCharges = (() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return creditTxns
      .filter((t) => t.date.startsWith(currentMonth) && t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  })();

  return (
    <div className="credit-tab">
      {/* Debt Summary Banner */}
      <section className="credit-banner">
        <div className="credit-banner-main">
          <span className="credit-banner-label">Total Debt</span>
          <span className="credit-banner-value negative">{formatCurrency(totalDebt)}</span>
        </div>
        {creditLimit > 0 && (
          <div className="credit-utilization">
            <div className="utilization-header">
              <span className="utilization-label">Credit Utilization</span>
              <span className={`utilization-pct ${utilization > 30 ? "warning" : ""}`}>
                {utilization.toFixed(1)}%
              </span>
            </div>
            <div className="utilization-bar-track">
              <div
                className={`utilization-bar-fill ${utilization > 30 ? "warning" : ""}`}
                style={{ width: `${Math.min(utilization, 100)}%` }}
              />
            </div>
            <div className="utilization-detail">
              {formatCurrency(totalDebt)} of {formatCurrency(creditLimit)}
            </div>
          </div>
        )}
        <div className="credit-banner-stats">
          {amex?.paymentDueDate && (
            <div className="credit-stat">
              <span className="credit-stat-label">Payment Due</span>
              <span className="credit-stat-value">{amex.paymentDueDate}</span>
            </div>
          )}
          {amex && amex.minimumPayment > 0 && (
            <div className="credit-stat">
              <span className="credit-stat-label">Minimum Payment</span>
              <span className="credit-stat-value negative">{formatCurrency(amex.minimumPayment)}</span>
            </div>
          )}
          {thisMonthCharges > 0 && (
            <div className="credit-stat">
              <span className="credit-stat-label">This Month Charges</span>
              <span className="credit-stat-value negative">{formatCurrency(thisMonthCharges)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Card Accounts */}
      {Object.entries(accountsByInstitution).map(([institution, accounts]) => (
        <section key={institution} className="institution-section">
          <h2 className="section-title">
            <span className={`institution-dot ${institution}`} />
            {institution.charAt(0).toUpperCase() + institution.slice(1)}
          </h2>
          <div className="accounts-row">
            {accounts.map((a) => (
              <AccountCard key={`${a.institution}-${a.accountNumber}`} account={a} />
            ))}
          </div>
        </section>
      ))}

      {/* Amex Card Details */}
      {amex && (
        <div className="credit-details-section">
          <AmexCardDetailsCard data={amex} />
        </div>
      )}

      {/* Recent Charges */}
      {recentCharges.length > 0 && (
        <section className="credit-recent">
          <h2 className="section-title">Recent Charges</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th className="amount-col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentCharges.map((t, i) => (
                  <tr key={`${t.date}-${t.description}-${i}`}>
                    <td className="date-col">{t.date}</td>
                    <td className="desc-col">
                      {t.description}
                      {t.isPending && <span className="pending-badge">Pending</span>}
                    </td>
                    <td className="account-col">{t.accountName}</td>
                    <td className={`amount-col ${t.amount >= 0 ? "positive" : "negative"}`}>
                      {formatCurrency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
