import type { ScrapeResult } from "../types";
import { formatCurrency } from "../utils/format";
import { AccountCard } from "./AccountCard";
import { SpendingChart } from "./SpendingChart";

export function Dashboard({ data }: { data: ScrapeResult }) {
  const totalBalance = data.accounts.reduce((s, a) => s + a.currentBalance, 0);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTxns = data.transactions.filter((t) => t.date.startsWith(currentMonth));
  const monthIncome = thisMonthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthSpending = thisMonthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  const largest = data.transactions.reduce(
    (max, t) => (Math.abs(t.amount) > Math.abs(max.amount) ? t : max),
    data.transactions[0]
  );

  return (
    <div className="dashboard">
      <section className="accounts-row">
        {data.accounts.map((a) => (
          <AccountCard key={a.accountNumber} account={a} />
        ))}
        <div className="account-card total">
          <span className="account-type">total</span>
          <h3>All Accounts</h3>
          <span className="balance">{formatCurrency(totalBalance)}</span>
        </div>
      </section>

      <section className="stats-row">
        <div className="stat-card">
          <span className="stat-label">This Month Income</span>
          <span className="stat-value positive">{formatCurrency(monthIncome)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">This Month Spending</span>
          <span className="stat-value negative">{formatCurrency(Math.abs(monthSpending))}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Largest Transaction</span>
          <span className="stat-value">{formatCurrency(Math.abs(largest?.amount ?? 0))}</span>
          <span className="stat-detail">{largest?.description.slice(0, 40)}</span>
        </div>
      </section>

      <section className="chart-section">
        <h2>Monthly Cash Flow</h2>
        <SpendingChart transactions={data.transactions} />
      </section>
    </div>
  );
}
