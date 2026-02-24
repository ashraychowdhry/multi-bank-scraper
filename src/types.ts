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

export interface CashInterest {
  apy: number; // e.g. 3.35
  cashEarningInterest: number;
  interestAccruedThisMonth: number;
  lifetimeInterestPaid: number;
}

export interface StockLendingIncome {
  lastMonth: number;
  total: number;
  stocksOnLoan: { ticker: string; name: string; shares: number }[];
}

export interface ChaseOffer {
  merchant: string;
  reward: string; // e.g. "10% cash back", "Up to 15% back", "$100 cash back"
  isExpiringSoon: boolean;
  daysLeft?: string; // e.g. "5d left"
  isActivated: boolean; // already added to card
  accountName: string; // which card/account the offer is linked to
  institution: string;
}

export interface ScraperResult {
  institution: string;
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  cashInterest?: CashInterest;
  stockLending?: StockLendingIncome;
  offers?: ChaseOffer[];
}

export interface ScrapeResult {
  scrapedAt: string; // ISO timestamp
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  cashInterest?: CashInterest;
  stockLending?: StockLendingIncome;
  offers?: ChaseOffer[];
}
