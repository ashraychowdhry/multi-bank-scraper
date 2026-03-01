import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type {
  ScrapeResult,
  ChaseOffer,
  AmexOffer,
  CapitalOneOffer,
} from "./types.js";

const EXPORT_DIR = "export";

// ── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(
  filePath: string,
  headers: string[],
  rows: unknown[][]
): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

/** Read existing transactions CSV, returning a Set of dedup keys and parsed rows. */
function readExistingTransactions(
  filePath: string
): { keys: Set<string>; rows: unknown[][] } {
  const keys = new Set<string>();
  const rows: unknown[][] = [];
  if (!fs.existsSync(filePath)) return { keys, rows };

  const content = fs.readFileSync(filePath, "utf-8").trim();
  const lines = content.split("\n");
  if (lines.length <= 1) return { keys, rows };

  // Skip header, parse each line
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 7) continue;
    // dedup key: date|description|amount|account_name|institution
    const key = `${fields[0]}|${fields[1]}|${fields[2]}|${fields[5]}|${fields[6]}`;
    if (!keys.has(key)) {
      keys.add(key);
      rows.push(fields);
    }
  }
  return { keys, rows };
}

/** Minimal CSV line parser that handles quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── Offer normalization ──────────────────────────────────────────────────────

interface NormalizedOffer {
  institution: string;
  merchant: string;
  reward: string;
  description: string;
  expires_at: string;
  is_active: boolean;
  reward_type: string;
  reward_amount: string;
  account_name: string;
}

function normalizeOffers(data: ScrapeResult): NormalizedOffer[] {
  const offers: NormalizedOffer[] = [];

  if (data.offers) {
    for (const o of data.offers as ChaseOffer[]) {
      offers.push({
        institution: o.institution || "chase",
        merchant: o.merchant,
        reward: o.reward || "",
        description: "",
        expires_at: normalizeDaysLeft(o.daysLeft),
        is_active: o.isActivated,
        reward_type: "",
        reward_amount: o.reward || "",
        account_name: o.accountName || "",
      });
    }
  }

  if (data.amexOffers) {
    for (const o of data.amexOffers as AmexOffer[]) {
      offers.push({
        institution: "amex",
        merchant: o.merchant,
        reward: o.rewardAmount || "",
        description: o.description,
        expires_at: normalizeOfferDate(o.expiresAt),
        is_active: o.isAdded,
        reward_type: o.rewardType,
        reward_amount: o.rewardAmount || "",
        account_name: "",
      });
    }
  }

  if (data.capitalOneOffers) {
    for (const o of data.capitalOneOffers as CapitalOneOffer[]) {
      offers.push({
        institution: "capitalone",
        merchant: o.merchant,
        reward: o.rewardAmount || "",
        description: o.description,
        expires_at: o.expiresAt || "",
        is_active: o.isAdded,
        reward_type: o.rewardType,
        reward_amount: o.rewardAmount || "",
        account_name: "",
      });
    }
  }

  return offers;
}

/** Convert Chase "5d left" to an ISO date by adding days to today. */
function normalizeDaysLeft(daysLeft?: string): string {
  if (!daysLeft) return "";
  const match = daysLeft.match(/(\d+)d\s*left/i);
  if (match) {
    const days = parseInt(match[1], 10);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  return daysLeft;
}

/** Normalize Amex expiration dates (MM/DD/YY) to ISO YYYY-MM-DD. */
function normalizeOfferDate(dateStr?: string): string {
  if (!dateStr) return "";
  // MM/DD/YY or MM/DD/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return dateStr;
}

// ── Card details normalization ───────────────────────────────────────────────

interface NormalizedCardDetails {
  institution: string;
  card_name: string;
  last_four_digits: string;
  statement_balance: number;
  total_balance: number;
  minimum_payment: number;
  payment_due_date: string;
  credit_limit: number;
  available_credit: number;
  rewards_balance: string;
}

function normalizeCardDetails(data: ScrapeResult): NormalizedCardDetails[] {
  const cards: NormalizedCardDetails[] = [];

  if (data.amexCardDetails) {
    const d = data.amexCardDetails;
    cards.push({
      institution: "amex",
      card_name: "Platinum Card",
      last_four_digits: "",
      statement_balance: d.statementBalance,
      total_balance: d.totalBalance,
      minimum_payment: d.minimumPayment,
      payment_due_date: d.paymentDueDate,
      credit_limit: d.creditLimit,
      available_credit: d.availableCredit,
      rewards_balance: "",
    });
  }

  if (data.capitalOneCards) {
    for (const c of data.capitalOneCards) {
      cards.push({
        institution: "capitalone",
        card_name: c.cardName,
        last_four_digits: c.lastFourDigits,
        statement_balance: c.statementBalance,
        total_balance: c.totalBalance,
        minimum_payment: c.minimumPayment,
        payment_due_date: c.paymentDueDate,
        credit_limit: c.creditLimit,
        available_credit: c.availableCredit,
        rewards_balance: c.rewardsBalance || "",
      });
    }
  }

  return cards;
}

// ── CSV Export ────────────────────────────────────────────────────────────────

export function exportToCSV(data: ScrapeResult, dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = data.scrapedAt;

  // Accounts (overwrite)
  writeCsv(
    path.join(dir, "accounts.csv"),
    [
      "institution",
      "name",
      "type",
      "current_balance",
      "available_balance",
      "account_number",
      "scraped_at",
    ],
    data.accounts.map((a) => [
      a.institution,
      a.name,
      a.type,
      a.currentBalance,
      a.availableBalance ?? "",
      a.accountNumber,
      ts,
    ])
  );

  // Transactions (append + dedup)
  const txHeaders = [
    "date",
    "description",
    "amount",
    "category",
    "is_pending",
    "account_name",
    "institution",
    "scraped_at",
  ];
  const txPath = path.join(dir, "transactions.csv");
  const existing = readExistingTransactions(txPath);
  for (const t of data.transactions) {
    const key = `${t.date}|${t.description}|${t.amount}|${t.accountName}|${t.institution}`;
    if (!existing.keys.has(key)) {
      existing.keys.add(key);
      existing.rows.push([
        t.date,
        t.description,
        t.amount,
        t.category || "",
        t.isPending ? "true" : "false",
        t.accountName,
        t.institution,
        ts,
      ]);
    }
  }
  writeCsv(txPath, txHeaders, existing.rows);

  // Holdings (overwrite)
  writeCsv(
    path.join(dir, "holdings.csv"),
    [
      "ticker",
      "name",
      "shares",
      "current_price",
      "current_value",
      "cost_basis",
      "gain_loss",
      "gain_loss_percent",
      "institution",
      "account_name",
      "scraped_at",
    ],
    data.holdings.map((h) => [
      h.ticker,
      h.name,
      h.shares,
      h.currentPrice,
      h.currentValue,
      h.costBasis,
      h.gainLoss,
      h.gainLossPercent,
      h.institution,
      h.accountName || "",
      ts,
    ])
  );

  // Cash interest (overwrite)
  if (data.cashInterest) {
    const ci = data.cashInterest;
    writeCsv(
      path.join(dir, "cash_interest.csv"),
      [
        "apy",
        "cash_earning_interest",
        "interest_accrued_this_month",
        "lifetime_interest_paid",
        "scraped_at",
      ],
      [
        [
          ci.apy,
          ci.cashEarningInterest,
          ci.interestAccruedThisMonth,
          ci.lifetimeInterestPaid,
          ts,
        ],
      ]
    );
  }

  // Stock lending (overwrite)
  if (data.stockLending) {
    const sl = data.stockLending;
    writeCsv(
      path.join(dir, "stock_lending.csv"),
      ["last_month", "total", "scraped_at"],
      [[sl.lastMonth, sl.total, ts]]
    );
    writeCsv(
      path.join(dir, "stocks_on_loan.csv"),
      ["ticker", "name", "shares", "scraped_at"],
      sl.stocksOnLoan.map((s) => [s.ticker, s.name, s.shares, ts])
    );
  }

  // Offers (overwrite — all institutions)
  const offers = normalizeOffers(data);
  if (offers.length > 0) {
    writeCsv(
      path.join(dir, "offers.csv"),
      [
        "institution",
        "merchant",
        "reward",
        "description",
        "expires_at",
        "is_active",
        "reward_type",
        "reward_amount",
        "account_name",
        "scraped_at",
      ],
      offers.map((o) => [
        o.institution,
        o.merchant,
        o.reward,
        o.description,
        o.expires_at,
        o.is_active ? "true" : "false",
        o.reward_type,
        o.reward_amount,
        o.account_name,
        ts,
      ])
    );
  }

  // Card details (overwrite — Amex + Capital One)
  const cards = normalizeCardDetails(data);
  if (cards.length > 0) {
    writeCsv(
      path.join(dir, "card_details.csv"),
      [
        "institution",
        "card_name",
        "last_four_digits",
        "statement_balance",
        "total_balance",
        "minimum_payment",
        "payment_due_date",
        "credit_limit",
        "available_credit",
        "rewards_balance",
        "scraped_at",
      ],
      cards.map((c) => [
        c.institution,
        c.card_name,
        c.last_four_digits,
        c.statement_balance,
        c.total_balance,
        c.minimum_payment,
        c.payment_due_date,
        c.credit_limit,
        c.available_credit,
        c.rewards_balance,
        ts,
      ])
    );
  }

  // Rewards (overwrite — Capital One + Amex combined)
  const rewardsRows: unknown[][] = [];
  if (data.capitalOneRewards) {
    for (const r of data.capitalOneRewards) {
      rewardsRows.push([
        "capitalone",
        r.cardName,
        r.lastFourDigits,
        r.rewardsType,
        r.totalBalance,
        r.totalBalanceNumeric,
        "",
        "",
        ts,
      ]);
    }
  }
  if (data.amexRewards) {
    const ar = data.amexRewards;
    rewardsRows.push([
      "amex",
      ar.cardName,
      "",
      "points",
      `${ar.availablePoints.toLocaleString()} points`,
      ar.availablePoints,
      ar.pointsEarnedThisYear,
      ar.pointsUsedThisYear,
      ts,
    ]);
  }
  if (rewardsRows.length > 0) {
    writeCsv(
      path.join(dir, "rewards.csv"),
      [
        "institution",
        "card_name",
        "last_four_digits",
        "rewards_type",
        "total_balance",
        "total_balance_numeric",
        "earned_this_year",
        "used_this_year",
        "scraped_at",
      ],
      rewardsRows
    );
  }
}

// ── SQLite Export ─────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    institution TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    current_balance REAL NOT NULL,
    available_balance REAL,
    account_number TEXT NOT NULL,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (institution, account_number)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    is_pending INTEGER NOT NULL DEFAULT 0,
    account_name TEXT NOT NULL,
    institution TEXT NOT NULL,
    scraped_at TEXT NOT NULL,
    UNIQUE (date, description, amount, account_name, institution)
  );

  CREATE TABLE IF NOT EXISTS holdings (
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    shares REAL NOT NULL,
    current_price REAL NOT NULL,
    current_value REAL NOT NULL,
    cost_basis REAL NOT NULL,
    gain_loss REAL NOT NULL,
    gain_loss_percent REAL NOT NULL,
    institution TEXT NOT NULL,
    account_name TEXT DEFAULT '',
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_interest (
    apy REAL NOT NULL,
    cash_earning_interest REAL NOT NULL,
    interest_accrued_this_month REAL NOT NULL,
    lifetime_interest_paid REAL NOT NULL,
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_lending (
    last_month REAL NOT NULL,
    total REAL NOT NULL,
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stocks_on_loan (
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    shares REAL NOT NULL,
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offers (
    institution TEXT NOT NULL,
    merchant TEXT NOT NULL,
    reward TEXT,
    description TEXT,
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    reward_type TEXT,
    reward_amount TEXT,
    account_name TEXT,
    scraped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_details (
    institution TEXT NOT NULL,
    card_name TEXT NOT NULL,
    last_four_digits TEXT,
    statement_balance REAL NOT NULL,
    total_balance REAL NOT NULL,
    minimum_payment REAL NOT NULL,
    payment_due_date TEXT NOT NULL,
    credit_limit REAL NOT NULL,
    available_credit REAL NOT NULL,
    rewards_balance TEXT,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (institution, card_name)
  );

  CREATE TABLE IF NOT EXISTS rewards (
    institution TEXT NOT NULL,
    card_name TEXT NOT NULL,
    last_four_digits TEXT NOT NULL DEFAULT '',
    rewards_type TEXT NOT NULL,
    total_balance TEXT NOT NULL,
    total_balance_numeric REAL NOT NULL,
    earned_this_year REAL,
    used_this_year REAL,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (institution, card_name)
  );
`;

export function exportToSQLite(data: ScrapeResult, dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const ts = data.scrapedAt;

  // Accounts — snapshot (delete + insert)
  db.exec("DELETE FROM accounts");
  const insertAccount = db.prepare(
    `INSERT INTO accounts (institution, name, type, current_balance, available_balance, account_number, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const a of data.accounts) {
    insertAccount.run(
      a.institution,
      a.name,
      a.type,
      a.currentBalance,
      a.availableBalance ?? null,
      a.accountNumber,
      ts
    );
  }

  // Transactions — accumulate (INSERT OR IGNORE)
  const insertTx = db.prepare(
    `INSERT OR IGNORE INTO transactions (date, description, amount, category, is_pending, account_name, institution, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTxMany = db.transaction((txns: typeof data.transactions) => {
    for (const t of txns) {
      insertTx.run(
        t.date,
        t.description,
        t.amount,
        t.category || null,
        t.isPending ? 1 : 0,
        t.accountName,
        t.institution,
        ts
      );
    }
  });
  insertTxMany(data.transactions);

  // Holdings — snapshot
  db.exec("DELETE FROM holdings");
  const insertHolding = db.prepare(
    `INSERT INTO holdings (ticker, name, shares, current_price, current_value, cost_basis, gain_loss, gain_loss_percent, institution, account_name, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const h of data.holdings) {
    insertHolding.run(
      h.ticker,
      h.name,
      h.shares,
      h.currentPrice,
      h.currentValue,
      h.costBasis,
      h.gainLoss,
      h.gainLossPercent,
      h.institution,
      h.accountName || null,
      ts
    );
  }

  // Cash interest — snapshot
  if (data.cashInterest) {
    db.exec("DELETE FROM cash_interest");
    db.prepare(
      `INSERT INTO cash_interest (apy, cash_earning_interest, interest_accrued_this_month, lifetime_interest_paid, scraped_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      data.cashInterest.apy,
      data.cashInterest.cashEarningInterest,
      data.cashInterest.interestAccruedThisMonth,
      data.cashInterest.lifetimeInterestPaid,
      ts
    );
  }

  // Stock lending — snapshot
  if (data.stockLending) {
    db.exec("DELETE FROM stock_lending");
    db.prepare(
      `INSERT INTO stock_lending (last_month, total, scraped_at) VALUES (?, ?, ?)`
    ).run(data.stockLending.lastMonth, data.stockLending.total, ts);

    db.exec("DELETE FROM stocks_on_loan");
    const insertLoan = db.prepare(
      `INSERT INTO stocks_on_loan (ticker, name, shares, scraped_at) VALUES (?, ?, ?, ?)`
    );
    for (const s of data.stockLending.stocksOnLoan) {
      insertLoan.run(s.ticker, s.name, s.shares, ts);
    }
  }

  // Offers — snapshot (all institutions)
  const offers = normalizeOffers(data);
  if (offers.length > 0) {
    db.exec("DELETE FROM offers");
    const insertOffer = db.prepare(
      `INSERT INTO offers (institution, merchant, reward, description, expires_at, is_active, reward_type, reward_amount, account_name, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const o of offers) {
      insertOffer.run(
        o.institution,
        o.merchant,
        o.reward,
        o.description,
        o.expires_at || null,
        o.is_active ? 1 : 0,
        o.reward_type || null,
        o.reward_amount || null,
        o.account_name || null,
        ts
      );
    }
  }

  // Card details — snapshot
  const cards = normalizeCardDetails(data);
  if (cards.length > 0) {
    db.exec("DELETE FROM card_details");
    const insertCard = db.prepare(
      `INSERT INTO card_details (institution, card_name, last_four_digits, statement_balance, total_balance, minimum_payment, payment_due_date, credit_limit, available_credit, rewards_balance, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of cards) {
      insertCard.run(
        c.institution,
        c.card_name,
        c.last_four_digits || null,
        c.statement_balance,
        c.total_balance,
        c.minimum_payment,
        c.payment_due_date,
        c.credit_limit,
        c.available_credit,
        c.rewards_balance || null,
        ts
      );
    }
  }

  // Rewards — snapshot (Capital One + Amex)
  const hasRewards =
    (data.capitalOneRewards && data.capitalOneRewards.length > 0) ||
    data.amexRewards;
  if (hasRewards) {
    db.exec("DELETE FROM rewards");
    const insertReward = db.prepare(
      `INSERT INTO rewards (institution, card_name, last_four_digits, rewards_type, total_balance, total_balance_numeric, earned_this_year, used_this_year, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    if (data.capitalOneRewards) {
      for (const r of data.capitalOneRewards) {
        insertReward.run(
          "capitalone",
          r.cardName,
          r.lastFourDigits,
          r.rewardsType,
          r.totalBalance,
          r.totalBalanceNumeric,
          null,
          null,
          ts
        );
      }
    }
    if (data.amexRewards) {
      const ar = data.amexRewards;
      insertReward.run(
        "amex",
        ar.cardName,
        "",
        "points",
        `${ar.availablePoints.toLocaleString()} points`,
        ar.availablePoints,
        ar.pointsEarnedThisYear,
        ar.pointsUsedThisYear,
        ts
      );
    }
  }

  db.close();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function exportAll(data: ScrapeResult): void {
  console.log("\n=== Exporting to CSV + SQLite ===");

  exportToCSV(data, EXPORT_DIR);
  console.log(`CSV files written to ${EXPORT_DIR}/`);

  exportToSQLite(data, path.join(EXPORT_DIR, "bank-scraper.db"));
  console.log(`SQLite database written to ${EXPORT_DIR}/bank-scraper.db`);

  // Summary
  const csvFiles = fs
    .readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith(".csv"));
  console.log(`  ${csvFiles.length} CSV file(s): ${csvFiles.join(", ")}`);
  console.log(
    `  ${data.accounts.length} account(s), ${data.transactions.length} transaction(s), ${data.holdings.length} holding(s)`
  );
}
