import type { ScrapeResult } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { bankingAccounts, sumBalance, transactionsForAccountTypes, groupBy } from "../utils/accountHelpers";
import { AccountCard } from "./AccountCard";
import { CashInterestCard } from "./CashInterestCard";
import { SpendingChart } from "./SpendingChart";

export function Banking({ data }: { data: ScrapeResult }) {
  const banking = bankingAccounts(data.accounts);
  const cashTotal = sumBalance(banking);
  const bankingTxns = transactionsForAccountTypes(data.transactions, data.accounts, ["checking", "savings"]);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTxns = bankingTxns.filter((t) => t.date.startsWith(currentMonth));
  const monthIncome = thisMonthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthSpending = thisMonthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const monthNet = monthIncome + monthSpending;

  const accountsByInstitution = groupBy(banking, (a) => a.institution);

  const recentTxns = [...bankingTxns]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);

  return (
    <div className="banking-tab">
      {/* Cash Total Banner */}
      <section className="banking-banner">
        <div className="banking-banner-main">
          <span className="banking-banner-label">Total Cash</span>
          <span className="banking-banner-value">{formatCurrency(cashTotal)}</span>
        </div>
        <div className="banking-banner-stats">
          <div className="banking-flow-stat">
            <span className="banking-flow-label">Income</span>
            <span className="banking-flow-value positive">{formatCurrency(monthIncome)}</span>
          </div>
          <div className="banking-flow-stat">
            <span className="banking-flow-label">Spending</span>
            <span className="banking-flow-value negative">{formatCurrency(Math.abs(monthSpending))}</span>
          </div>
          <div className="banking-flow-stat">
            <span className="banking-flow-label">Net Flow</span>
            <span className={`banking-flow-value ${monthNet >= 0 ? "positive" : "negative"}`}>
              {monthNet >= 0 ? "+" : ""}{formatCurrency(monthNet)}
            </span>
          </div>
        </div>
      </section>

      {/* Accounts by Institution */}
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

      {/* Cash Interest */}
      {data.cashInterest && (
        <div className="banking-interest-section">
          <CashInterestCard data={data.cashInterest} />
        </div>
      )}

      {/* Recent Banking Transactions */}
      {recentTxns.length > 0 && (
        <section className="banking-recent">
          <h2 className="section-title">Recent Transactions</h2>
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
                {recentTxns.map((t, i) => (
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

      {/* Cash Flow Chart */}
      {bankingTxns.length > 0 && (
        <section className="chart-section">
          <h2>Monthly Cash Flow</h2>
          <SpendingChart transactions={bankingTxns} />
        </section>
      )}
    </div>
  );
}
