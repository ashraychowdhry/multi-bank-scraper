import type { ScrapeResult, CapitalOneRewards } from "@shared/types";
import { formatCurrency } from "../utils/format";

export function Rewards({ data }: { data: ScrapeResult }) {
  const rewards = data.capitalOneRewards || [];

  if (rewards.length === 0) {
    return (
      <div className="rewards-tab">
        <div className="rewards-empty">
          No rewards data available. Run scraper with Capital One to load rewards.
        </div>
      </div>
    );
  }

  return (
    <div className="rewards-tab">
      {rewards.map((r) => (
        <RewardsCard key={`${r.cardName}-${r.lastFourDigits}`} reward={r} />
      ))}
    </div>
  );
}

function RewardsCard({ reward }: { reward: CapitalOneRewards }) {
  return (
    <div className="rewards-card">
      <div className="rewards-card-header">
        <div className="rewards-card-title">
          <span className="institution-dot capitalone" />
          <h3>{reward.cardName}</h3>
          <span className="rewards-last-four">...{reward.lastFourDigits}</span>
        </div>
        <span className="rewards-type-badge">{reward.rewardsType}</span>
      </div>

      <div className="rewards-balance">
        <span className="rewards-balance-label">Rewards Balance</span>
        <span className="rewards-balance-value">{reward.totalBalance}</span>
        {reward.rewardsType === "cash back" && reward.totalBalanceNumeric > 0 && (
          <span className="rewards-balance-cash">
            {formatCurrency(reward.totalBalanceNumeric)}
          </span>
        )}
      </div>

      {/* Category Breakdown */}
      {reward.categoryBreakdown && reward.categoryBreakdown.length > 0 && (
        <div className="rewards-categories">
          <h4>Earning Rates</h4>
          <div className="rewards-category-list">
            {reward.categoryBreakdown.map((cat, i) => (
              <div key={`${cat.category}-${i}`} className="rewards-category-item">
                <span className="rewards-category-name">{cat.category}</span>
                <span className="rewards-category-rate">{cat.rate}</span>
                {cat.earned && (
                  <span className="rewards-category-earned">{cat.earned}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {reward.recentActivity && reward.recentActivity.length > 0 && (
        <div className="rewards-activity">
          <h4>Recent Activity</h4>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="amount-col">Earned</th>
                </tr>
              </thead>
              <tbody>
                {reward.recentActivity.map((a, i) => (
                  <tr key={`${a.date}-${i}`}>
                    <td className="date-col">{a.date}</td>
                    <td className="desc-col">{a.description}</td>
                    <td className="amount-col positive">{a.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
