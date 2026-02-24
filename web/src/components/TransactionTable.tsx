import { useState, useMemo } from "react";
import type { Transaction } from "@shared/types";
import { formatCurrency, formatDate, formatMonthLabel } from "../utils/format";
import { classifyTransaction } from "../utils/classifyTransaction";
import { Filters } from "./Filters";

type SortKey = "date" | "description" | "amount";
type SortDir = "asc" | "desc";

export function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [institutionFilter, setInstitutionFilter] = useState("all");
  const [showCount, setShowCount] = useState(50);

  const accountOptions = useMemo(
    () => [...new Set(transactions.map((t) => t.accountName))].sort(),
    [transactions]
  );

  const monthOptions = useMemo(() => {
    return [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
  }, [transactions]);

  const institutionOptions = useMemo(
    () => [...new Set(transactions.map((t) => t.institution))].sort(),
    [transactions]
  );

  const filtered = useMemo(() => {
    let txns = [...transactions];

    if (search) {
      const q = search.toLowerCase();
      txns = txns.filter((t) => t.description.toLowerCase().includes(q));
    }
    if (accountFilter !== "all") {
      txns = txns.filter((t) => t.accountName === accountFilter);
    }
    if (monthFilter !== "all") {
      txns = txns.filter((t) => t.date.startsWith(monthFilter));
    }
    if (institutionFilter !== "all") {
      txns = txns.filter((t) => t.institution === institutionFilter);
    }

    txns.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "amount") cmp = a.amount - b.amount;
      else cmp = a.description.localeCompare(b.description);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return txns;
  }, [transactions, search, accountFilter, monthFilter, institutionFilter, sortKey, sortDir]);

  // Summary stats for filtered transactions
  const totalIn = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const netAmount = totalIn + totalOut;

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of filtered) {
      const cat = classifyTransaction(t);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [filtered]);

  const visible = filtered.slice(0, showCount);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  function resetFilters() {
    setShowCount(50);
  }

  return (
    <div className="transaction-table">
      {/* Summary Stats */}
      <div className="txn-summary-row">
        <div className="txn-summary-stat">
          <span className="txn-summary-label">Money In</span>
          <span className="txn-summary-value positive">{formatCurrency(totalIn)}</span>
        </div>
        <div className="txn-summary-stat">
          <span className="txn-summary-label">Money Out</span>
          <span className="txn-summary-value negative">{formatCurrency(Math.abs(totalOut))}</span>
        </div>
        <div className="txn-summary-stat">
          <span className="txn-summary-label">Net</span>
          <span className={`txn-summary-value ${netAmount >= 0 ? "positive" : "negative"}`}>
            {netAmount >= 0 ? "+" : ""}{formatCurrency(netAmount)}
          </span>
        </div>
        <div className="txn-summary-stat">
          <span className="txn-summary-label">Count</span>
          <span className="txn-summary-value">{filtered.length}</span>
        </div>
      </div>

      {/* Category Breakdown Pills */}
      {categoryBreakdown.length > 0 && (
        <div className="txn-category-pills">
          {categoryBreakdown.map(([cat, count]) => (
            <span key={cat} className="txn-category-pill">
              {cat} <span className="txn-category-count">{count}</span>
            </span>
          ))}
        </div>
      )}

      <Filters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetFilters(); }}
        accountFilter={accountFilter}
        onAccountFilterChange={(v) => { setAccountFilter(v); resetFilters(); }}
        monthFilter={monthFilter}
        onMonthFilterChange={(v) => { setMonthFilter(v); resetFilters(); }}
        institutionFilter={institutionFilter}
        onInstitutionFilterChange={(v) => { setInstitutionFilter(v); resetFilters(); }}
        accountOptions={accountOptions}
        monthOptions={monthOptions}
        institutionOptions={institutionOptions}
      />
      <div className="table-info">
        Showing {visible.length} of {filtered.length} transactions
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort("date")} className="sortable">
                Date{sortIndicator("date")}
              </th>
              <th onClick={() => handleSort("description")} className="sortable">
                Description{sortIndicator("description")}
              </th>
              <th>Account</th>
              <th onClick={() => handleSort("amount")} className="sortable amount-col">
                Amount{sortIndicator("amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => (
              <tr key={`${t.date}-${t.description}-${i}`}>
                <td className="date-col">{formatDate(t.date)}</td>
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
      {visible.length < filtered.length && (
        <button
          className="show-more"
          onClick={() => setShowCount((c) => c + 50)}
        >
          Show more ({filtered.length - visible.length} remaining)
        </button>
      )}
    </div>
  );
}
