import { chromium, BrowserContext, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { Config } from "./config.js";
import { ChaseAccount, ChaseTransaction } from "./types.js";

const DASHBOARD_URL =
  "https://secure.chase.com/web/auth/dashboard#/dashboard/overview";
const LOGIN_URL =
  "https://secure.chase.com/web/auth/#/logon/logon/chaseOnline";

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

export async function launchBrowser(config: Config) {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const contextOptions = {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 } as const,
  };

  let context: BrowserContext;
  if (fs.existsSync(config.authStatePath)) {
    console.log("Loading saved session state...");
    context = await browser.newContext({
      ...contextOptions,
      storageState: config.authStatePath,
    });
  } else {
    context = await browser.newContext(contextOptions);
  }

  const page = await context.newPage();
  return { browser, context, page };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(page: Page, config: Config): Promise<boolean> {
  // Try loading the dashboard directly — if session cookies are valid
  // this skips login entirely.
  console.log("Checking for active session...");
  await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 20000 });

  if (await isLoggedIn(page)) {
    console.log("Already logged in via saved session!");
    return true;
  }

  // Session expired or doesn't exist — go to login page
  console.log("Session not active. Navigating to login...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 20000 });

  const userIdInput = page.locator("#userId-input-field-input");
  await userIdInput.waitFor({ state: "visible", timeout: 10000 });

  console.log("Entering credentials...");
  await userIdInput.fill(config.chaseUsername);
  await page.locator("#password-input-field-input").fill(config.chasePassword);

  // Check "Remember me" — SVG overlay requires force click
  try {
    await page.locator("#rememberMe").check({ force: true, timeout: 2000 });
  } catch {
    // Not critical
  }

  await page.locator("#signin-button").click();
  console.log("Submitted credentials...");
  await page.waitForTimeout(3000);

  // Check for credential errors (specific text, not generic alerts)
  const loginError = page.locator(
    'text="Please check your information",' +
      'text="enter a valid user ID",' +
      'text="enter a valid password",' +
      'text="doesn\'t match our records"'
  );
  if (await loginError.first().isVisible().catch(() => false)) {
    const msg = await loginError.first().textContent().catch(() => "");
    console.error(`Login failed: ${msg || "check your credentials."}`);
    return false;
  }

  if (await isLoggedIn(page)) {
    console.log("Login successful (no 2FA required).");
    return true;
  }

  return await handle2FA(page);
}

// ---------------------------------------------------------------------------
// 2FA — polls URL until dashboard appears (no terminal input needed)
// ---------------------------------------------------------------------------

async function handle2FA(page: Page): Promise<boolean> {
  console.log("\n========================================");
  console.log("  TWO-FACTOR AUTHENTICATION REQUIRED");
  console.log("========================================");
  console.log("Complete the 2FA in the browser window.");
  console.log("Waiting for you to finish (up to 3 minutes)...\n");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (page.url().includes("dashboard") || page.url().includes("/account")) {
      console.log("2FA completed — dashboard detected.");
      await page.waitForTimeout(2000);
      return true;
    }
  }

  console.error("Timed out waiting for 2FA completion.");
  return false;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function isLoggedIn(page: Page): Promise<boolean> {
  // Check URL first
  const url = page.url();
  if (url.includes("dashboard") || url.includes("/account")) {
    // Verify content actually loaded (not just a redirect)
    try {
      await page.waitForSelector('[data-testid="accountTile"]', {
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function saveSession(
  context: BrowserContext,
  config: Config
): Promise<void> {
  const dir = path.dirname(config.authStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: config.authStatePath });
  console.log(`Session saved to ${config.authStatePath}`);
}

// ---------------------------------------------------------------------------
// Scrape accounts
// ---------------------------------------------------------------------------

export async function scrapeAccounts(page: Page): Promise<ChaseAccount[]> {
  console.log("Scraping accounts from dashboard...");

  if (!page.url().includes("dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle" });
  }

  await page.waitForSelector('[data-testid="accountTile"]', {
    timeout: 10000,
  });
  await page.waitForTimeout(1500);

  const accounts: ChaseAccount[] = [];
  const tiles = await page.$$('[data-testid="accountTile"]');
  console.log(`Found ${tiles.length} account tile(s).`);

  for (const tile of tiles) {
    try {
      const data = await tile.evaluate((el) => {
        const text = el.textContent || "";

        // Account name is in <mds-button text="CHASE COLLEGE (...2885)">
        // inside [data-testid="accounts-name-link"]
        const nameBtn = el.querySelector(
          '[data-testid="accounts-name-link"] mds-button'
        );
        const name = nameBtn?.getAttribute("text") || "";

        // Last 4 digits from the name
        const acctMatch = name.match(/\.{2,3}(\d{4})/);

        // Balance: first dollar amount in tile textContent
        const dollarMatch = text.match(/\$[\d,]+\.\d{2}/);
        const balance = dollarMatch ? dollarMatch[0] : "";

        return { name, accountNumber: acctMatch?.[1] || "", balance };
      });

      console.log(
        `  ${data.name || "(unnamed)"} — ${data.balance || "no balance"}`
      );

      if (data.balance) {
        accounts.push({
          name: data.name || `Account ...${data.accountNumber}`,
          type: inferAccountType(data.name),
          currentBalance: parseBalance(data.balance),
          accountNumber: data.accountNumber,
        });
      }
    } catch (err) {
      console.warn("Error parsing account tile:", err);
    }
  }

  console.log(`Parsed ${accounts.length} account(s).`);
  return accounts;
}

// ---------------------------------------------------------------------------
// Scrape transactions
// ---------------------------------------------------------------------------

export async function scrapeTransactions(
  page: Page,
  accounts: ChaseAccount[]
): Promise<ChaseTransaction[]> {
  const allTransactions: ChaseTransaction[] = [];

  for (const account of accounts) {
    try {
      console.log(`Scraping transactions for: ${account.name}`);

      // Navigate to account detail page via the name button
      const nameBtn = page
        .locator(
          `[data-testid="accounts-name-link"] mds-button[text*="${account.accountNumber}"]`
        )
        .first();

      if (!(await nameBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
        console.warn(`  Could not find link for ${account.name}, skipping.`);
        continue;
      }

      const urlBefore = page.url();
      await nameBtn.evaluate((el) => {
        const inner = el.shadowRoot?.querySelector("button, a") || el;
        (inner as HTMLElement).click();
      });

      // Wait for URL to change (detail page URL contains "summary")
      await page
        .waitForURL((url) => url.toString() !== urlBefore, { timeout: 10000 })
        .catch(() => {});
      console.log(`  Navigated to: ${page.url()}`);

      // Wait for the detail page transaction table to fully render.
      // Chase's SPA needs time to hydrate — the table rows load async.
      await page
        .waitForSelector('tr[id*="ACTIVITY-dataTableId-row-"]', {
          timeout: 15000,
        })
        .catch(() => console.log("  Transaction table not found."));
      await page.waitForTimeout(2000);

      // Try CSV download first (most complete data)
      const csvTxns = await downloadTransactionsCSV(page, account.name);
      if (csvTxns.length > 0) {
        console.log(`  ${csvTxns.length} transaction(s) from CSV.`);
        allTransactions.push(...csvTxns);
      } else {
        // Fall back to scraping the detail page transaction table
        console.log("  CSV not available, scraping transaction table...");
        const tableTxns = await scrapeDetailTransactions(
          page,
          account.name
        );
        allTransactions.push(...tableTxns);
      }
    } catch (err) {
      console.warn(`  Error scraping ${account.name}:`, err);
    }

    // Always return to dashboard for next account
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  }

  return allTransactions;
}

// ---------------------------------------------------------------------------
// Detail page transactions (full activity table)
// ---------------------------------------------------------------------------

async function scrapeDetailTransactions(
  page: Page,
  accountName: string
): Promise<ChaseTransaction[]> {
  const transactions: ChaseTransaction[] = [];

  // Detail page table rows: tr[id*="ACTIVITY-dataTableId-row-"]
  // Header row has id ending in "column-headers" — data rows end in "row-N"
  // Each data row: <th> = date, <td>s = description, type, amount, balance, action
  const rows = await page.$$('tr[id*="ACTIVITY-dataTableId-row-"]');
  console.log(`  Found ${rows.length} transaction row(s) on detail page.`);

  for (const row of rows) {
    try {
      const data = await row.evaluate((el) => {
        const th = el.querySelector("th");
        const tds = el.querySelectorAll("td");
        if (tds.length < 2) return null;

        const dateText = th?.textContent?.trim() || "";

        // Description: use accessible text span to avoid duplicates
        const descSpan = tds[0]?.querySelector(
          '[data-testid="rich-text-accessible-text"]'
        );
        const descText =
          descSpan?.textContent?.trim() || tds[0]?.textContent?.trim() || "";

        // Amount: column with dollar amount (index varies — find it)
        // Columns: Description, Type, Amount, Balance, Action
        // Amount is typically tds[2] but let's find the first cell with $
        let amountRaw = "";
        for (let i = 1; i < tds.length; i++) {
          const cellText = tds[i]?.textContent?.trim() || "";
          const match = cellText.match(/[\u2212-]?\$[\d,]+\.\d{2}/);
          if (match) {
            amountRaw = match[0];
            break;
          }
        }

        return {
          date: dateText,
          description: descText,
          amountRaw,
          isPending: dateText.toLowerCase().includes("pending"),
        };
      });

      if (data?.date && data.amountRaw) {
        transactions.push({
          date: normalizeDate(data.date),
          description: data.description,
          amount: parseBalance(data.amountRaw),
          isPending: data.isPending,
          accountName,
          category: undefined,
        });
      }
    } catch {
      // Skip unparseable rows
    }
  }

  console.log(`  Parsed ${transactions.length} transaction(s).`);
  return transactions;
}

// ---------------------------------------------------------------------------
// CSV download (from account detail page)
// ---------------------------------------------------------------------------

async function downloadTransactionsCSV(
  page: Page,
  accountName: string
): Promise<ChaseTransaction[]> {
  try {
    // The download icon button on the account detail page:
    const dlBtn = page.locator(
      '[data-testid="quick-action-download-activity-tooltip-button"]'
    );

    if (!(await dlBtn.isVisible({ timeout: 3000 }))) {
      return [];
    }

    await dlBtn.click();
    await page.waitForTimeout(2000);

    // A download modal appears with:
    //   Account: pre-selected
    //   File type: "Spreadsheet (Excel, CSV)" — already the default
    //   Activity: "Current display, including filters"
    //   [Cancel] [Download] — both are <mds-button> web components

    // Click the Download <mds-button text="Download"> via shadow DOM
    const downloadMdsBtn = page.locator('mds-button[text="Download"]').first();
    if (!(await downloadMdsBtn.isVisible({ timeout: 3000 }))) {
      console.log("  Download button not found in modal.");
      return [];
    }

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      downloadMdsBtn.evaluate((el) => {
        const inner = el.shadowRoot?.querySelector("button") || el;
        (inner as HTMLElement).click();
      }),
    ]);

    const filePath = await download.path();
    if (!filePath) return [];

    const csvContent = fs.readFileSync(filePath, "utf-8");
    console.log(`  Downloaded CSV (${csvContent.length} bytes).`);
    return parseChaseCSV(csvContent, accountName);
  } catch (err) {
    console.log(`  CSV download failed: ${err}`);
    return [];
  }
}

function parseChaseCSV(
  csv: string,
  accountName: string
): ChaseTransaction[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length <= 1) return [];

  const header = lines[0].toLowerCase();
  const isCredit = header.includes("category");
  const transactions: ChaseTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;

    if (isCredit) {
      transactions.push({
        date: normalizeDate(cols[0]),
        description: cols[2].trim().replace(/\s{2,}/g, " "),
        amount: parseFloat(cols[5]) || 0,
        category: cols[3].trim() || undefined,
        isPending: false,
        accountName,
      });
    } else {
      transactions.push({
        date: normalizeDate(cols[1]),
        description: cols[2].trim().replace(/\s{2,}/g, " "),
        amount: parseFloat(cols[3]) || 0,
        category: undefined,
        isPending: false,
        accountName,
      });
    }
  }

  return transactions;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function inferAccountType(name: string): ChaseAccount["type"] {
  const lower = name.toLowerCase();
  if (lower.includes("checking") || lower.includes("college")) return "checking";
  if (lower.includes("saving")) return "savings";
  if (
    lower.includes("credit") ||
    lower.includes("card") ||
    lower.includes("sapphire") ||
    lower.includes("freedom") ||
    lower.includes("slate") ||
    lower.includes("ink")
  )
    return "credit";
  if (
    lower.includes("invest") ||
    lower.includes("you invest") ||
    lower.includes("brokerage")
  )
    return "investment";
  return "other";
}

function parseBalance(str: string | undefined): number {
  if (!str) return 0;
  return (
    parseFloat(str.replace(/[$,]/g, "").replace(/\u2212/g, "-").trim()) || 0
  );
}

function normalizeDate(dateStr: string): string {
  const trimmed = dateStr.trim();

  // MM/DD/YYYY → YYYY-MM-DD (CSV format)
  const slashParts = trimmed.split("/");
  if (slashParts.length === 3) {
    return `${slashParts[2]}-${slashParts[0].padStart(2, "0")}-${slashParts[1].padStart(2, "0")}`;
  }

  // "Feb 20, 2026" → YYYY-MM-DD (dashboard format)
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return trimmed;
}
