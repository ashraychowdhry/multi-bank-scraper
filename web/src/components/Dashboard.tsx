import type { ScrapeResult } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { computeNetWorth, groupBy } from "../utils/accountHelpers";
import { AccountCard } from "./AccountCard";
import { SpendingChart } from "./SpendingChart";
import { CashInterestCard } from "./CashInterestCard";
import { StockLendingCard } from "./StockLendingCard";
import { TopHoldings } from "./TopHoldings";
import { TopMovers } from "./TopMovers";

export function Dashboard({ data }: { data: ScrapeResult }) {
  const { netWorth, cashTotal, investmentTotal, debtTotal } = computeNetWorth(data.accounts);
  const totalHoldingsValue = data.holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalHoldingsCost = data.holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalHoldingsGainLoss = data.holdings.reduce((s, h) => s + h.gainLoss, 0);

  // Monthly stats (from transactions)
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTxns = data.transactions.filter((t) => t.date.startsWith(currentMonth));
  const monthIncome = thisMonthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthSpending = thisMonthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  const accountsByInstitution = groupBy(data.accounts, (a) => a.institution);

  return (
    <div className="dashboard">
      {/* Net Worth Banner */}
      <section className="net-worth-banner">
        <div className="net-worth-main">
          <span className="net-worth-label">Net Worth</span>
          <span className="net-worth-value">{formatCurrency(netWorth)}</span>
        </div>
        <div className="net-worth-breakdown">
          {cashTotal > 0 && (
            <div className="breakdown-item">
              <span className="breakdown-dot banking" />
              <span className="breakdown-label">Cash</span>
              <span className="breakdown-value">{formatCurrency(cashTotal)}</span>
            </div>
          )}
          {investmentTotal > 0 && (
            <div className="breakdown-item">
              <span className="breakdown-dot investment" />
              <span className="breakdown-label">Investments</span>
              <span className="breakdown-value">{formatCurrency(investmentTotal)}</span>
            </div>
          )}
          {debtTotal > 0 && (
            <div className="breakdown-item">
              <span className="breakdown-dot debt" />
              <span className="breakdown-label">Debt</span>
              <span className="breakdown-value negative">-{formatCurrency(debtTotal)}</span>
            </div>
          )}
          {data.holdings.length > 0 && totalHoldingsGainLoss !== 0 && (
            <div className="breakdown-item">
              <span className={`breakdown-dot ${totalHoldingsGainLoss >= 0 ? "gain" : "loss"}`} />
              <span className="breakdown-label">Total Return</span>
              <span className={`breakdown-value ${totalHoldingsGainLoss >= 0 ? "positive" : "negative"}`}>
                {totalHoldingsGainLoss >= 0 ? "+" : ""}{formatCurrency(totalHoldingsGainLoss)}
                {" "}({totalHoldingsCost > 0 ? ((totalHoldingsGainLoss / totalHoldingsCost) * 100).toFixed(1) : "0"}%)
              </span>
            </div>
          )}
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

      {/* Stats Row */}
      <section className="stats-row">
        {data.transactions.length > 0 && (
          <>
            <div className="stat-card">
              <span className="stat-label">This Month Income</span>
              <span className="stat-value positive">{formatCurrency(monthIncome)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">This Month Spending</span>
              <span className="stat-value negative">{formatCurrency(Math.abs(monthSpending))}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Transactions</span>
              <span className="stat-value">{data.transactions.length}</span>
            </div>
          </>
        )}
        {data.holdings.length > 0 && (
          <>
            <div className="stat-card">
              <span className="stat-label">Portfolio Value</span>
              <span className="stat-value">{formatCurrency(totalHoldingsValue)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Cost Basis</span>
              <span className="stat-value">{formatCurrency(totalHoldingsCost)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Positions</span>
              <span className="stat-value">{data.holdings.length}</span>
            </div>
          </>
        )}
      </section>

      {/* Passive Income: Interest + Stock Lending */}
      {(data.cashInterest || data.stockLending) && (
        <div className="passive-income-grid">
          {data.cashInterest && <CashInterestCard data={data.cashInterest} />}
          {data.stockLending && <StockLendingCard data={data.stockLending} />}
        </div>
      )}

      {/* Portfolio Allocation + Top Movers */}
      {data.holdings.length > 0 && (
        <div className="portfolio-grid">
          <section className="chart-section">
            <h2>Top Holdings by Value</h2>
            <TopHoldings holdings={data.holdings} />
          </section>
          <section className="chart-section">
            <h2>Top Movers</h2>
            <TopMovers holdings={data.holdings} />
          </section>
        </div>
      )}

      {/* Cash Flow Chart */}
      {data.transactions.length > 0 && (
        <section className="chart-section">
          <h2>Monthly Cash Flow</h2>
          <SpendingChart transactions={data.transactions} />
        </section>
      )}
    </div>
  );
}
