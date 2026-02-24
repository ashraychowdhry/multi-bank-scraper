import type { Holding } from "@shared/types";
import { formatCurrency } from "../utils/format";
import { aggregateHoldings } from "../utils/aggregateHoldings";

export function TopHoldings({ holdings }: { holdings: Holding[] }) {
  const aggregated = aggregateHoldings(holdings);
  const sorted = [...aggregated].sort((a, b) => b.currentValue - a.currentValue);
  const top = sorted.slice(0, 8);
  const totalValue = aggregated.reduce((s, h) => s + h.currentValue, 0);

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
