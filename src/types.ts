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
  accountName?: string;
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

export interface AmexOffer {
  merchant: string;
  description: string;
  expiresAt?: string;
  isAdded: boolean;
  rewardType: "credit" | "points";
  rewardAmount?: string;
}

export interface AmexCreditCardDetails {
  statementBalance: number;
  totalBalance: number;
  minimumPayment: number;
  paymentDueDate: string; // YYYY-MM-DD
  creditLimit: number;
  availableCredit: number;
  lastPaymentAmount?: number;
  lastPaymentDate?: string; // YYYY-MM-DD
}

export interface CapitalOneCardDetails {
  cardName: string;
  lastFourDigits: string;
  statementBalance: number;
  totalBalance: number;
  minimumPayment: number;
  paymentDueDate: string; // YYYY-MM-DD
  creditLimit: number;
  availableCredit: number;
  rewardsBalance?: string; // e.g. "85,000 miles" or "$120.00 cash back"
}

export interface CapitalOneOffer {
  merchant: string;
  description: string;
  expiresAt?: string;
  isAdded: boolean;
  rewardType: "cash back" | "miles" | "other";
  rewardAmount?: string; // e.g. "5% cash back", "3x miles"
}

export interface CapitalOneRewards {
  cardName: string;
  lastFourDigits: string;
  rewardsType: "miles" | "cash back" | "points" | "other";
  totalBalance: string; // "XX,XXX miles" or "$X,XXX.XX"
  totalBalanceNumeric: number; // e.g. 10000 or 1227.26
  recentActivity?: CapitalOneRewardActivity[];
  categoryBreakdown?: { category: string; rate: string; earned: string }[];
}

export interface CapitalOneRewardActivity {
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // "+XX miles" or "+$X.XX"
}

export interface AmexRewards {
  cardName: string;
  availablePoints: number;
  pointsEarnedThisYear: number;
  pointsUsedThisYear: number;
  recentActivity?: { date: string; description: string; points: string }[];
}

export interface ScraperResult {
  institution: string;
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  cashInterest?: CashInterest;
  stockLending?: StockLendingIncome;
  offers?: ChaseOffer[];
  amexOffers?: AmexOffer[];
  amexCardDetails?: AmexCreditCardDetails;
  amexRewards?: AmexRewards;
  capitalOneCards?: CapitalOneCardDetails[];
  capitalOneOffers?: CapitalOneOffer[];
  capitalOneRewards?: CapitalOneRewards[];
}

export interface ScrapeResult {
  scrapedAt: string; // ISO timestamp
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  cashInterest?: CashInterest;
  stockLending?: StockLendingIncome;
  offers?: ChaseOffer[];
  amexOffers?: AmexOffer[];
  amexCardDetails?: AmexCreditCardDetails;
  amexRewards?: AmexRewards;
  capitalOneCards?: CapitalOneCardDetails[];
  capitalOneOffers?: CapitalOneOffer[];
  capitalOneRewards?: CapitalOneRewards[];
}
