import { useState } from "react";
import { useData } from "./hooks/useData";
import { formatDate } from "./utils/format";
import { Dashboard } from "./components/Dashboard";
import { TransactionTable } from "./components/TransactionTable";

export default function App() {
  const { data, loading, error } = useData();
  const [tab, setTab] = useState<"overview" | "transactions">("overview");

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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chase Dashboard</h1>
        <span className="scraped-at">Last updated: {formatDate(data.scrapedAt)}</span>
      </header>
      <nav className="tabs">
        <button
          onClick={() => setTab("overview")}
          className={tab === "overview" ? "active" : ""}
        >
          Overview
        </button>
        <button
          onClick={() => setTab("transactions")}
          className={tab === "transactions" ? "active" : ""}
        >
          Transactions ({data.transactions.length})
        </button>
      </nav>
      <main>
        {tab === "overview" && <Dashboard data={data} />}
        {tab === "transactions" && <TransactionTable transactions={data.transactions} />}
      </main>
    </div>
  );
}
