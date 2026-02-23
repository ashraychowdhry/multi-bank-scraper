export interface ChaseAccount {
  name: string;
  type: "checking" | "savings" | "credit" | "investment" | "other";
  currentBalance: number;
  availableBalance?: number;
  accountNumber: string;
}

export interface ChaseTransaction {
  date: string;
  description: string;
  amount: number;
  category?: string;
  isPending: boolean;
  accountName: string;
}

export interface ScrapeResult {
  scrapedAt: string;
  accounts: ChaseAccount[];
  transactions: ChaseTransaction[];
}
