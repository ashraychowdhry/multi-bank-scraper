import type { ChaseAccount } from "../types";
import { formatCurrency } from "../utils/format";

export function AccountCard({ account }: { account: ChaseAccount }) {
  return (
    <div className={`account-card ${account.type}`}>
      <span className="account-type">{account.type}</span>
      <h3>{account.name}</h3>
      <span className="balance">{formatCurrency(account.currentBalance)}</span>
    </div>
  );
}
