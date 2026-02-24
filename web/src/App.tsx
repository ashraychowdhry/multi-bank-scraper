import { useState, useMemo } from "react";
import { useData } from "./hooks/useData";
import { formatDate } from "./utils/format";
import { creditAccounts } from "./utils/accountHelpers";
import { Dashboard } from "./components/Dashboard";
import { Banking } from "./components/Banking";
import { TransactionTable } from "./components/TransactionTable";
import { HoldingsTab } from "./components/HoldingsTab";
import { Credit } from "./components/Credit";
import { Coupons } from "./components/Coupons";
import { Rewards } from "./components/Rewards";

type Tab = "overview" | "banking" | "transactions" | "holdings" | "credit" | "rewards" | "coupons";

export default function App() {
  const { data, loading, error } = useData();
  const [tab, setTab] = useState<Tab>("overview");

  const counts = useMemo(() => {
    if (!data) return { banking: 0, transactions: 0, holdings: 0, credit: 0, rewards: 0, coupons: 0 };
    return {
      banking: data.accounts.filter((a) => a.type === "checking" || a.type === "savings").length,
      transactions: data.transactions.length,
      holdings: data.holdings.length,
      credit: creditAccounts(data.accounts).length,
      rewards: data.capitalOneRewards?.length || 0,
      coupons: (data.offers?.length || 0) + (data.amexOffers?.length || 0) + (data.capitalOneOffers?.length || 0),
    };
  }, [data]);

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
        {counts.banking > 0 && (
          <button
            onClick={() => setTab("banking")}
            className={tab === "banking" ? "active" : ""}
          >
            Banking
          </button>
        )}
        {counts.transactions > 0 && (
          <button
            onClick={() => setTab("transactions")}
            className={tab === "transactions" ? "active" : ""}
          >
            Transactions ({counts.transactions})
          </button>
        )}
        {counts.holdings > 0 && (
          <button
            onClick={() => setTab("holdings")}
            className={tab === "holdings" ? "active" : ""}
          >
            Holdings ({counts.holdings})
          </button>
        )}
        {counts.credit > 0 && (
          <button
            onClick={() => setTab("credit")}
            className={tab === "credit" ? "active" : ""}
          >
            Credit
          </button>
        )}
        {counts.rewards > 0 && (
          <button
            onClick={() => setTab("rewards")}
            className={tab === "rewards" ? "active" : ""}
          >
            Rewards
          </button>
        )}
        {counts.coupons > 0 && (
          <button
            onClick={() => setTab("coupons")}
            className={tab === "coupons" ? "active" : ""}
          >
            Coupons ({counts.coupons})
          </button>
        )}
      </nav>
      <main>
        {tab === "overview" && <Dashboard data={data} />}
        {tab === "banking" && <Banking data={data} />}
        {tab === "transactions" && <TransactionTable transactions={data.transactions} />}
        {tab === "holdings" && <HoldingsTab data={data} />}
        {tab === "credit" && <Credit data={data} />}
        {tab === "rewards" && <Rewards data={data} />}
        {tab === "coupons" && <Coupons data={data} />}
      </main>
    </div>
  );
}
