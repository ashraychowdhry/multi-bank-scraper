import type { Account, Transaction, AccountType } from "@shared/types";

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (map[k] ||= []).push(item);
  }
  return map;
}

const BANKING_TYPES: AccountType[] = ["checking", "savings"];
const INVESTMENT_TYPES: AccountType[] = ["brokerage", "investment"];
const DEBT_TYPES: AccountType[] = ["credit"];

export function bankingAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => BANKING_TYPES.includes(a.type));
}

export function investmentAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => INVESTMENT_TYPES.includes(a.type));
}

export function creditAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => DEBT_TYPES.includes(a.type));
}

export function sumBalance(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + a.currentBalance, 0);
}

export function computeNetWorth(accounts: Account[]): {
  netWorth: number;
  cashTotal: number;
  investmentTotal: number;
  debtTotal: number;
} {
  const cashTotal = sumBalance(bankingAccounts(accounts));
  const investmentTotal = sumBalance(investmentAccounts(accounts));
  const debtTotal = sumBalance(creditAccounts(accounts));
  return {
    netWorth: cashTotal + investmentTotal - debtTotal,
    cashTotal,
    investmentTotal,
    debtTotal,
  };
}

export function transactionsForAccountTypes(
  transactions: Transaction[],
  accounts: Account[],
  types: AccountType[]
): Transaction[] {
  const accountNames = new Set(
    accounts.filter((a) => types.includes(a.type)).map((a) => a.name)
  );
  return transactions.filter((t) => accountNames.has(t.accountName));
}
