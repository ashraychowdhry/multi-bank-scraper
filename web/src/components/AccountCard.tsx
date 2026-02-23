import type { Account } from "@shared/types";
import { formatCurrency } from "../utils/format";

export function AccountCard({ account }: { account: Account }) {
  return (
    <div className={`account-card ${account.type}`}>
      <div className="account-card-header">
        <span className="account-type">{account.type}</span>
      </div>
      <h3>{account.name}</h3>
      <span className="balance">{formatCurrency(account.currentBalance)}</span>
      {account.availableBalance !== undefined && account.availableBalance !== account.currentBalance && (
        <span className="available-balance">
          {formatCurrency(account.availableBalance)} available
        </span>
      )}
    </div>
  );
}
