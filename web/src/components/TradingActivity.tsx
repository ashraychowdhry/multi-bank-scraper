import { useState, useMemo, Fragment } from "react";
import type { Transaction } from "@shared/types";
import { formatCurrency, formatDate } from "../utils/format";
import { classifyTransaction, isTrade, extractStockName } from "../utils/classifyTransaction";

type TradeFilter = "all" | "buy" | "sell";
type SortKey = "stock" | "buyTotal" | "sellTotal" | "net" | "tradeCount";
type SortDir = "asc" | "desc";

interface StockTradeGroup {
  stock: string;
  trades: Transaction[];
  buyTotal: number;
  sellTotal: number;
  net: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
}

export function TradingActivity({ transactions }: { transactions: Transaction[] }) {
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>("all");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("buyTotal");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // All trades (buy + sell)
  const allTrades = useMemo(
    () => transactions.filter(isTrade),
    [transactions]
  );

  const buys = allTrades.filter((t) => classifyTransaction(t) === "buy");
  const sells = allTrades.filter((t) => classifyTransaction(t) === "sell");

  const totalInvested = buys.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalProceeds = sells.reduce((s, t) => s + t.amount, 0);
  const netCashFlow = totalProceeds - totalInvested;

  const monthOptions = useMemo(
    () => [...new Set(allTrades.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [allTrades]
  );

  // Group trades by stock name
  const stockGroups = useMemo(() => {
    let trades = [...allTrades];

    if (monthFilter !== "all") {
      trades = trades.filter((t) => t.date.startsWith(monthFilter));
    }
    if (tradeFilter === "buy") {
      trades = trades.filter((t) => classifyTransaction(t) === "buy");
    } else if (tradeFilter === "sell") {
      trades = trades.filter((t) => classifyTransaction(t) === "sell");
    }

    const groups = new Map<string, Transaction[]>();
    for (const t of trades) {
      const stock = extractStockName(t);
      const existing = groups.get(stock);
      if (existing) existing.push(t);
      else groups.set(stock, [t]);
    }

    const result: StockTradeGroup[] = [];
    for (const [stock, stockTrades] of groups) {
      const stockBuys = stockTrades.filter((t) => classifyTransaction(t) === "buy");
      const stockSells = stockTrades.filter((t) => classifyTransaction(t) === "sell");
      const buyTotal = stockBuys.reduce((s, t) => s + Math.abs(t.amount), 0);
      const sellTotal = stockSells.reduce((s, t) => s + t.amount, 0);

      result.push({
        stock,
        trades: stockTrades.sort((a, b) => b.date.localeCompare(a.date)),
        buyTotal,
        sellTotal,
        net: sellTotal - buyTotal,
        tradeCount: stockTrades.length,
        buyCount: stockBuys.length,
        sellCount: stockSells.length,
      });
    }

    // Apply search
    let filtered = result;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((g) => g.stock.toLowerCase().includes(q));
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "stock") {
        cmp = a.stock.localeCompare(b.stock);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [allTrades, tradeFilter, monthFilter, search, sortKey, sortDir]);

  // Filtered summary totals
  const filteredBuyTotal = stockGroups.reduce((s, g) => s + g.buyTotal, 0);
  const filteredSellTotal = stockGroups.reduce((s, g) => s + g.sellTotal, 0);
  const filteredNet = filteredSellTotal - filteredBuyTotal;
  const filteredTradeCount = stockGroups.reduce((s, g) => s + g.tradeCount, 0);

  const hasActiveFilter = tradeFilter !== "all" || monthFilter !== "all" || search;
  const displayInvested = hasActiveFilter ? filteredBuyTotal : totalInvested;
  const displayProceeds = hasActiveFilter ? filteredSellTotal : totalProceeds;
  const displayNet = hasActiveFilter ? filteredNet : netCashFlow;
  const displayCount = hasActiveFilter ? filteredTradeCount : allTrades.length;

  function toggleExpand(stock: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(stock)) next.delete(stock);
      else next.add(stock);
      return next;
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "stock" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  return (
    <div className="trading-activity">
      <div className="trade-summary">
        <div className="stat-card">
          <span className="stat-label">Total Invested</span>
          <span className="stat-value negative">{formatCurrency(displayInvested)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Proceeds</span>
          <span className="stat-value positive">{formatCurrency(displayProceeds)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Net Cash Flow</span>
          <span className={`stat-value ${displayNet >= 0 ? "positive" : "negative"}`}>
            {displayNet >= 0 ? "+" : ""}{formatCurrency(displayNet)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Trades</span>
          <span className="stat-value">{displayCount}</span>
        </div>
      </div>

      <div className="trade-controls">
        <div className="trade-type-filter">
          <button
            className={tradeFilter === "all" ? "active" : ""}
            onClick={() => setTradeFilter("all")}
          >
            All Trades ({allTrades.length})
          </button>
          <button
            className={tradeFilter === "buy" ? "active" : ""}
            onClick={() => setTradeFilter("buy")}
          >
            Buys ({buys.length})
          </button>
          <button
            className={tradeFilter === "sell" ? "active" : ""}
            onClick={() => setTradeFilter("sell")}
          >
            Sells ({sells.length})
          </button>
        </div>
        <div className="trade-filters-right">
          {monthOptions.length > 1 && (
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All months</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="Search stock..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-search"
          />
        </div>
      </div>

      <div className="table-info">
        {stockGroups.length} stock{stockGroups.length !== 1 ? "s" : ""} traded
        {hasActiveFilter && " \u2014 filtered"}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort("stock")} className="sortable">
                Stock{sortIndicator("stock")}
              </th>
              <th onClick={() => handleSort("buyTotal")} className="sortable amount-col">
                Bought{sortIndicator("buyTotal")}
              </th>
              <th onClick={() => handleSort("sellTotal")} className="sortable amount-col">
                Sold{sortIndicator("sellTotal")}
              </th>
              <th onClick={() => handleSort("net")} className="sortable amount-col">
                Net{sortIndicator("net")}
              </th>
              <th onClick={() => handleSort("tradeCount")} className="sortable amount-col">
                Trades{sortIndicator("tradeCount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stockGroups.map((g) => {
              const isExpanded = expanded.has(g.stock);
              return (
                <Fragment key={g.stock}>
                  <tr
                    className="expandable-row"
                    onClick={() => toggleExpand(g.stock)}
                  >
                    <td className="ticker-col">
                      <span className={`expand-chevron ${isExpanded ? "open" : ""}`}>&#9654;</span>
                      {g.stock}
                    </td>
                    <td className="amount-col negative">
                      {g.buyTotal > 0 ? formatCurrency(g.buyTotal) : "\u2014"}
                    </td>
                    <td className="amount-col positive">
                      {g.sellTotal > 0 ? formatCurrency(g.sellTotal) : "\u2014"}
                    </td>
                    <td className={`amount-col ${g.net >= 0 ? "positive" : "negative"}`}>
                      {g.net >= 0 ? "+" : ""}{formatCurrency(g.net)}
                    </td>
                    <td className="amount-col">
                      {g.buyCount > 0 && <span className="trade-badge buy">{g.buyCount}B</span>}
                      {g.sellCount > 0 && <span className="trade-badge sell">{g.sellCount}S</span>}
                    </td>
                  </tr>
                  {isExpanded && g.trades.map((t, idx) => {
                    const cat = classifyTransaction(t);
                    return (
                      <tr key={`${g.stock}-${idx}`} className="trade-sub-row">
                        <td className="sub-ticker">
                          <span className={`trade-badge ${cat}`}>
                            {cat === "buy" ? "BUY" : "SELL"}
                          </span>
                          <span className="trade-date">{formatDate(t.date)}</span>
                        </td>
                        <td colSpan={3} className="trade-desc">{t.description}</td>
                        <td className={`amount-col ${t.amount >= 0 ? "positive" : "negative"}`}>
                          {t.amount >= 0 ? "+" : ""}{formatCurrency(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td className="ticker-col">TOTAL</td>
              <td className="amount-col negative">{formatCurrency(filteredBuyTotal)}</td>
              <td className="amount-col positive">{formatCurrency(filteredSellTotal)}</td>
              <td className={`amount-col ${filteredNet >= 0 ? "positive" : "negative"}`}>
                {filteredNet >= 0 ? "+" : ""}{formatCurrency(filteredNet)}
              </td>
              <td className="amount-col">{filteredTradeCount}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
