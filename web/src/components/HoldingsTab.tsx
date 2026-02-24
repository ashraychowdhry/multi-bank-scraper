import type { ScrapeResult } from "@shared/types";
import { HoldingsTable } from "./HoldingsTable";
import { TopMovers } from "./TopMovers";
import { TradingActivity } from "./TradingActivity";
import { isTrade } from "../utils/classifyTransaction";

export function HoldingsTab({ data }: { data: ScrapeResult }) {
  const holdings = data.holdings;
  const hasTrades = data.transactions.some(isTrade);

  // Asset allocation: stocks vs crypto
  const CRYPTO_TICKERS = new Set([
    "BTC", "ETH", "DOGE", "SOL", "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC",
    "SHIB", "UNI", "LTC", "BCH", "XLM", "AAVE", "COMP", "ETC", "USDC", "USDT",
    "XTZ", "ZRX", "BAT",
  ]);

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const cryptoValue = holdings
    .filter((h) => CRYPTO_TICKERS.has(h.ticker))
    .reduce((s, h) => s + h.currentValue, 0);
  const stockValue = totalValue - cryptoValue;
  const stockPct = totalValue > 0 ? (stockValue / totalValue) * 100 : 0;
  const cryptoPct = totalValue > 0 ? (cryptoValue / totalValue) * 100 : 0;

  return (
    <div className="holdings-tab">
      {/* Asset Allocation Bar */}
      {totalValue > 0 && cryptoValue > 0 && (
        <section className="allocation-section">
          <h2 className="section-title">Asset Allocation</h2>
          <div className="allocation-bar-container">
            <div className="allocation-bar-full">
              <div
                className="allocation-bar-segment stocks"
                style={{ width: `${stockPct}%` }}
              />
              <div
                className="allocation-bar-segment crypto"
                style={{ width: `${cryptoPct}%` }}
              />
            </div>
            <div className="allocation-legend">
              <span className="allocation-legend-item">
                <span className="allocation-legend-dot stocks" />
                Stocks {stockPct.toFixed(1)}%
              </span>
              <span className="allocation-legend-item">
                <span className="allocation-legend-dot crypto" />
                Crypto {cryptoPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Positions Table */}
      <HoldingsTable holdings={holdings} />

      {/* Top Movers */}
      {holdings.length > 0 && (
        <section className="chart-section" style={{ marginTop: 28 }}>
          <h2>Top Movers</h2>
          <TopMovers holdings={holdings} />
        </section>
      )}

      {/* Trading Activity */}
      {hasTrades && (
        <section style={{ marginTop: 28 }}>
          <TradingActivity transactions={data.transactions} />
        </section>
      )}
    </div>
  );
}
