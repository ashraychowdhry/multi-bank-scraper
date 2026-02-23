export interface ChaseAccount {
  name: string;
  type: "checking" | "savings" | "credit" | "investment" | "other";
  currentBalance: number;
  availableBalance?: number;
  accountNumber: string; // last 4 digits
}

export interface ChaseTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative for debits, positive for credits
  category?: string;
  isPending: boolean;
  accountName: string;
}

export interface ScrapeResult {
  scrapedAt: string; // ISO timestamp
  accounts: ChaseAccount[];
  transactions: ChaseTransaction[];
}
