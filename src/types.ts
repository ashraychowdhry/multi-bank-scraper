export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "brokerage"
  | "other";

export interface Account {
  name: string;
  type: AccountType;
  currentBalance: number;
  availableBalance?: number;
  accountNumber: string;
  institution: string;
}

export interface Transaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative for debits, positive for credits
  category?: string;
  isPending: boolean;
  accountName: string;
  institution: string;
}

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPercent: number;
  institution: string;
}

export interface ScraperResult {
  institution: string;
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
}

export interface ScrapeResult {
  scrapedAt: string; // ISO timestamp
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
}
