import { useState } from "react";
import { useData } from "./hooks/useData";
import { formatDate } from "./utils/format";
import { Dashboard } from "./components/Dashboard";
import { TransactionTable } from "./components/TransactionTable";
import { HoldingsTable } from "./components/HoldingsTable";

type Tab = "overview" | "transactions" | "holdings";

export default function App() {
  const { data, loading, error } = useData();
  const [tab, setTab] = useState<Tab>("overview");

  if (loading) {
    return <div className="app"><div className="loading">Loading data...</div></div>;
  }
  if (error || !data) {
    return (
      <div className="app">
        <div className="error">
          Failed to load data. Run the scraper first, or check that{" "}
          <code>web/public/data.json</code> exists.
        </div>
      </div>
    );
  }

  const hasHoldings = data.holdings && data.holdings.length > 0;
  const hasTransactions = data.transactions && data.transactions.length > 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Financial Dashboard</h1>
        <span className="scraped-at">Last updated: {formatDate(data.scrapedAt)}</span>
      </header>
      <nav className="tabs">
        <button
          onClick={() => setTab("overview")}
          className={tab === "overview" ? "active" : ""}
        >
          Overview
        </button>
        {hasTransactions && (
          <button
            onClick={() => setTab("transactions")}
            className={tab === "transactions" ? "active" : ""}
          >
            Transactions ({data.transactions.length})
          </button>
        )}
        {hasHoldings && (
          <button
            onClick={() => setTab("holdings")}
            className={tab === "holdings" ? "active" : ""}
          >
            Holdings ({data.holdings.length})
          </button>
        )}
      </nav>
      <main>
        {tab === "overview" && <Dashboard data={data} />}
        {tab === "transactions" && <TransactionTable transactions={data.transactions} />}
        {tab === "holdings" && hasHoldings && <HoldingsTable holdings={data.holdings} />}
      </main>
    </div>
  );
}
