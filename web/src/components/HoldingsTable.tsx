import { useState, useMemo } from "react";
import type { Holding } from "@shared/types";
import { formatCurrency } from "../utils/format";

type SortKey = "ticker" | "name" | "currentValue" | "gainLoss" | "shares" | "gainLossPercent" | "currentPrice" | "costBasis";
type SortDir = "asc" | "desc";
type AssetFilter = "all" | "stocks" | "crypto";

// Common crypto tickers on Robinhood
const CRYPTO_TICKERS = new Set([
  "BTC", "ETH", "DOGE", "SOL", "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC",
  "SHIB", "UNI", "LTC", "BCH", "XLM", "AAVE", "COMP", "ETC", "USDC", "USDT",
  "XTZ", "ZRX", "BAT",
]);

function isCrypto(h: Holding): boolean {
  return CRYPTO_TICKERS.has(h.ticker);
}

function formatShares(n: number): string {
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCost = holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalGainLoss = holdings.reduce((s, h) => s + h.gainLoss, 0);
  const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

  const stocksCount = holdings.filter((h) => !isCrypto(h)).length;
  const cryptoCount = holdings.filter(isCrypto).length;

  const filtered = useMemo(() => {
    let items = [...holdings];

    if (assetFilter === "stocks") items = items.filter((h) => !isCrypto(h));
    if (assetFilter === "crypto") items = items.filter(isCrypto);

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (h) =>
          h.ticker.toLowerCase().includes(q) ||
          h.name.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "ticker" || sortKey === "name") {
        cmp = (a[sortKey] as string).localeCompare(b[sortKey] as string);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [holdings, search, assetFilter, sortKey, sortDir]);

  const filteredValue = filtered.reduce((s, h) => s + h.currentValue, 0);
  const filteredCost = filtered.reduce((s, h) => s + h.costBasis, 0);
  const filteredGainLoss = filtered.reduce((s, h) => s + h.gainLoss, 0);
  const filteredGainLossPercent = filteredCost > 0 ? (filteredGainLoss / filteredCost) * 100 : 0;

  // Use filtered totals when a filter is active
  const displayValue = assetFilter !== "all" || search ? filteredValue : totalValue;
  const displayCost = assetFilter !== "all" || search ? filteredCost : totalCost;
  const displayGainLoss = assetFilter !== "all" || search ? filteredGainLoss : totalGainLoss;
  const displayGainLossPercent = assetFilter !== "all" || search ? filteredGainLossPercent : totalGainLossPercent;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" || key === "name" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  return (
    <div className="holdings-table">
      <div className="holdings-summary">
        <div className="stat-card">
          <span className="stat-label">Portfolio Value</span>
          <span className="stat-value">{formatCurrency(displayValue)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Cost Basis</span>
          <span className="stat-value">{formatCurrency(displayCost)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Return</span>
          <span className={`stat-value ${displayGainLoss >= 0 ? "positive" : "negative"}`}>
            {displayGainLoss >= 0 ? "+" : ""}{formatCurrency(displayGainLoss)}
            <span className="stat-pct">
              {" "}({displayGainLossPercent >= 0 ? "+" : ""}{displayGainLossPercent.toFixed(2)}%)
            </span>
          </span>
        </div>
      </div>

      <div className="holdings-controls">
        <div className="asset-filter">
          <button
            className={assetFilter === "all" ? "active" : ""}
            onClick={() => setAssetFilter("all")}
          >
            All ({holdings.length})
          </button>
          <button
            className={assetFilter === "stocks" ? "active" : ""}
            onClick={() => setAssetFilter("stocks")}
          >
            Stocks ({stocksCount})
          </button>
          <button
            className={assetFilter === "crypto" ? "active" : ""}
            onClick={() => setAssetFilter("crypto")}
          >
            Crypto ({cryptoCount})
          </button>
        </div>
        <input
          type="text"
          placeholder="Search ticker or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="filter-search holdings-search"
        />
      </div>

      <div className="table-info">
        {filtered.length} holding{filtered.length !== 1 ? "s" : ""}
        {(assetFilter !== "all" || search) && ` (filtered)`}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort("ticker")} className="sortable">
                Ticker{sortIndicator("ticker")}
              </th>
              <th onClick={() => handleSort("name")} className="sortable">
                Name{sortIndicator("name")}
              </th>
              <th onClick={() => handleSort("shares")} className="sortable amount-col">
                Shares{sortIndicator("shares")}
              </th>
              <th onClick={() => handleSort("currentPrice")} className="sortable amount-col">
                Price{sortIndicator("currentPrice")}
              </th>
              <th onClick={() => handleSort("currentValue")} className="sortable amount-col">
                Value{sortIndicator("currentValue")}
              </th>
              <th onClick={() => handleSort("costBasis")} className="sortable amount-col">
                Cost{sortIndicator("costBasis")}
              </th>
              <th onClick={() => handleSort("gainLoss")} className="sortable amount-col">
                Return{sortIndicator("gainLoss")}
              </th>
              <th onClick={() => handleSort("gainLossPercent")} className="sortable amount-col">
                %{sortIndicator("gainLossPercent")}
              </th>
              <th className="amount-col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => {
              const weight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
              return (
                <tr key={h.ticker}>
                  <td className="ticker-col">{h.ticker}</td>
                  <td className="name-col">{h.name !== h.ticker ? h.name : ""}</td>
                  <td className="amount-col shares-col">{formatShares(h.shares)}</td>
                  <td className="amount-col">{formatCurrency(h.currentPrice)}</td>
                  <td className="amount-col">{formatCurrency(h.currentValue)}</td>
                  <td className="amount-col">{formatCurrency(h.costBasis)}</td>
                  <td className={`amount-col ${h.gainLoss >= 0 ? "positive" : "negative"}`}>
                    {h.gainLoss >= 0 ? "+" : ""}{formatCurrency(h.gainLoss)}
                  </td>
                  <td className={`amount-col ${h.gainLossPercent >= 0 ? "positive" : "negative"}`}>
                    {h.gainLossPercent >= 0 ? "+" : ""}{h.gainLossPercent.toFixed(1)}%
                  </td>
                  <td className="amount-col weight-col">
                    <div className="weight-bar-track">
                      <div className="weight-bar-fill" style={{ width: `${Math.min(weight, 100)}%` }} />
                    </div>
                    <span>{weight.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td className="ticker-col">TOTAL</td>
              <td></td>
              <td></td>
              <td></td>
              <td className="amount-col">{formatCurrency(filteredValue)}</td>
              <td className="amount-col">{formatCurrency(filteredCost)}</td>
              <td className={`amount-col ${filteredGainLoss >= 0 ? "positive" : "negative"}`}>
                {filteredGainLoss >= 0 ? "+" : ""}{formatCurrency(filteredGainLoss)}
              </td>
              <td className={`amount-col ${filteredGainLossPercent >= 0 ? "positive" : "negative"}`}>
                {filteredGainLossPercent >= 0 ? "+" : ""}{filteredGainLossPercent.toFixed(1)}%
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
