import type { Holding } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { aggregateHoldings } from "../utils/aggregateHoldings";

export function TopMovers({ holdings }: { holdings: Holding[] }) {
  const aggregated = aggregateHoldings(holdings);
  const withBasis = aggregated.filter((h) => h.costBasis > 0);
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
