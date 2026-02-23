import { useState, useMemo } from "react";
import type { Transaction } from "@shared/types";
import { formatCurrency, formatDate, formatMonthLabel } from "../utils/format";
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
