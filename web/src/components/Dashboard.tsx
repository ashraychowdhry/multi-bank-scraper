import type { ScrapeResult, Account, Holding } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { AccountCard } from "./AccountCard";
import { SpendingChart } from "./SpendingChart";

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (map[k] ||= []).push(item);
  }
  return map;
}

function TopHoldings({ holdings }: { holdings: Holding[] }) {
  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue);
  const top = sorted.slice(0, 8);
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);

  return (
    <div className="top-holdings">
      {top.map((h) => {
        const pct = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
        return (
          <div key={h.ticker} className="allocation-row">
            <div className="allocation-label">
              <span className="allocation-ticker">{h.ticker}</span>
              <span className="allocation-name">{h.name !== h.ticker ? h.name : ""}</span>
            </div>
            <div className="allocation-bar-track">
              <div
                className={`allocation-bar-fill ${h.gainLoss >= 0 ? "gain" : "loss"}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="allocation-values">
              <span className="allocation-value">{formatCurrency(h.currentValue)}</span>
              <span className="allocation-pct">{pct.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopMovers({ holdings }: { holdings: Holding[] }) {
  const withBasis = holdings.filter((h) => h.costBasis > 0);
  const gainers = [...withBasis].sort((a, b) => b.gainLoss - a.gainLoss).slice(0, 3);
  const losers = [...withBasis].sort((a, b) => a.gainLoss - b.gainLoss).slice(0, 3);

  return (
    <div className="top-movers">
      <div className="movers-col">
        <h4>Top Gainers</h4>
        {gainers.map((h) => (
          <div key={h.ticker} className="mover-row">
            <span className="mover-ticker">{h.ticker}</span>
            <span className="mover-gain positive">
              +{formatCurrency(h.gainLoss)} ({h.gainLossPercent > 0 ? "+" : ""}{h.gainLossPercent.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
      <div className="movers-col">
        <h4>Top Losers</h4>
        {losers.map((h) => (
          <div key={h.ticker} className="mover-row">
            <span className="mover-ticker">{h.ticker}</span>
            <span className="mover-gain negative">
              {formatCurrency(h.gainLoss)} ({h.gainLossPercent.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard({ data }: { data: ScrapeResult }) {
  const totalBalance = data.accounts.reduce((s, a) => s + a.currentBalance, 0);
  const totalHoldingsValue = data.holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalHoldingsCost = data.holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalHoldingsGainLoss = data.holdings.reduce((s, h) => s + h.gainLoss, 0);
  const netWorth = totalBalance;

  // Banking vs investment breakdown
  const bankingAccounts = data.accounts.filter(
    (a) => a.type === "checking" || a.type === "savings"
  );
  const investmentAccounts = data.accounts.filter(
    (a) => a.type === "brokerage" || a.type === "investment"
  );
  const bankingTotal = bankingAccounts.reduce((s, a) => s + a.currentBalance, 0);
  const investmentTotal = investmentAccounts.reduce((s, a) => s + a.currentBalance, 0);

  // Monthly stats (from transactions)
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTxns = data.transactions.filter((t) => t.date.startsWith(currentMonth));
  const monthIncome = thisMonthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthSpending = thisMonthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  // Holdings by type
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
          {bankingTotal > 0 && (
            <div className="breakdown-item">
              <span className="breakdown-dot banking" />
              <span className="breakdown-label">Cash</span>
              <span className="breakdown-value">{formatCurrency(bankingTotal)}</span>
            </div>
          )}
          {investmentTotal > 0 && (
            <div className="breakdown-item">
              <span className="breakdown-dot investment" />
              <span className="breakdown-label">Investments</span>
              <span className="breakdown-value">{formatCurrency(investmentTotal)}</span>
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
