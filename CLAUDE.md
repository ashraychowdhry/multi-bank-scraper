# Bank Scraper — Development Guide

## Project Overview
TypeScript + Playwright tool for scraping bank/brokerage account data (balances, transactions, holdings, interest, stock lending). Supports multiple institutions via a plugin architecture. Personal tool — no Plaid or paid services.

## Tech Stack
- **Runtime**: Node.js with `tsx` (runs TypeScript directly, no build step)
- **Browser automation**: Playwright (Chromium only)
- **Config**: `dotenv` for credentials in `.env`
- **Module system**: ESM (`"type": "module"` in package.json)
- **Web dashboard**: Vite + React 19 + TypeScript

## Project Structure
```
src/
  index.ts                    # Orchestrator: runs enabled scrapers, merges results, launches dashboard
  config.ts                   # Multi-scraper config (SCRAPERS env var, per-scraper creds)
  types.ts                    # Generic: Account, Transaction, Holding, CashInterest, StockLendingIncome, ScrapeResult
  scrapers/
    interface.ts              # Scraper interface contract
    registry.ts               # Map of scraper name → factory function
    browser.ts                # Shared: launchBrowser(), saveSession()
    utils.ts                  # Shared: parseBalance(), normalizeDate(), parseCSVLine()
    chase/
      index.ts                # ChaseScraper class
      login.ts                # Chase login, 2FA, isLoggedIn
      accounts.ts             # Account tile scraping, inferAccountType
      transactions.ts         # Transaction scraping (CSV + table fallback)
      csv.ts                  # Chase CSV parsing
    robinhood/
      index.ts                # RobinhoodScraper class
      login.ts                # Robinhood login, device-approval 2FA
      accounts.ts             # Portfolio value + buying power + cash balance + cash interest
      holdings.ts             # Stock + crypto holdings from /account/investing page
      transactions.ts         # Trade history from /account/history (buys, dividends, deposits, lending)
      stock-lending.ts        # Stock lending income from /account/stock-lending
    fidelity/
      index.ts                # FidelityScraper class
      login.ts                # Fidelity login, push-notification 2FA
      accounts.ts             # Account aggregation from positions CSV
      holdings.ts             # Holdings via positions CSV download
      transactions.ts         # Transaction history from Activity & Orders page
      csv.ts                  # Fidelity CSV parsing (positions + activity)
web/
  vite.config.ts              # Vite config with @shared alias to ../src
  tsconfig.json               # Extends base with @shared path
  src/
    App.tsx                   # Three tabs: Overview, Transactions, Holdings
    hooks/useData.ts          # Fetches /data.json, normalizes for backward compat
    utils/format.ts           # formatCurrency, formatDate, formatMonthLabel
    components/
      Dashboard.tsx           # Net worth banner, institution sections, interest/lending cards, top holdings, top movers, cash flow
      AccountCard.tsx         # Per-account card with type color bar
      TransactionTable.tsx    # Sortable/filterable transaction table with institution filter
      HoldingsTable.tsx       # Sortable holdings table with stocks/crypto filter, weight column, totals
      Filters.tsx             # Reusable search/account/month/institution filter bar
      SpendingChart.tsx       # Monthly income vs spending bar chart
    index.css                 # Full dark theme with all component styles
.auth/                        # Saved Playwright session states (gitignored)
output/                       # JSON output files (gitignored)
```

## Run Commands
```bash
SCRAPERS=chase npm run scrape                    # Chase only
SCRAPERS=robinhood npm run scrape                # Robinhood only
SCRAPERS=fidelity npm run scrape                 # Fidelity only
SCRAPERS=chase,robinhood,fidelity npm run scrape # All three
npm run scrape:headed                            # HEADLESS=false, visible browser
NO_DASHBOARD=true npm run scrape                 # Skip dashboard launch
```

---

## Git Workflow — CRITICAL

### Always Use Worktrees for New Work
When starting any new feature or task, **always create a fresh git worktree** before implementing. This prevents conflicts between parallel Claude Code threads working on the same codebase.

**Option A — Claude Code built-in** (preferred):
- Call `EnterWorktree` at the start of any implementation task
- Or use `isolation: "worktree"` when spawning Task agents
- Claude Code handles worktree creation/cleanup automatically

**Option B — Manual worktree**:
```bash
# Create a worktree for a new feature
git worktree add .claude/worktrees/<feature-name> -b <feature-branch> HEAD

# Work in the worktree directory
cd .claude/worktrees/<feature-name>

# When done, merge back to main
cd /path/to/main/repo
git merge <feature-branch>
git worktree remove .claude/worktrees/<feature-name>
```

### Merge Strategy
- Always merge feature branches into main (not rebase) to preserve history
- Before merging, verify: `npx tsc --noEmit` (types compile) and `SCRAPERS=chase,robinhood NO_DASHBOARD=true npm run scrape` (scrapers work)
- If parallel branches modify the same file, resolve conflicts by reading both versions and combining changes
- Never force-push to main

### When NOT to Use Worktrees
- Simple config changes, documentation updates, or single-file fixes can be done directly on main
- Research tasks that don't write code don't need worktrees

---

## Multi-Scraper Architecture

### Adding a New Scraper (Step-by-Step)
1. **Create directory**: `src/scrapers/{name}/`
2. **Create files** following the established pattern:
   - `index.ts` — Main scraper class implementing `Scraper` interface
   - `login.ts` — Login flow with `login(page, username, password)` and `isLoggedIn(page)` functions
   - `accounts.ts` — Account balance scraping
   - `transactions.ts` — Transaction history scraping (if available)
   - `holdings.ts` — Investment holdings scraping (if applicable)
   - `csv.ts` — CSV parsing helpers (if institution supports CSV download)
3. **Register** in `src/scrapers/registry.ts`:
   ```typescript
   import { NewScraper } from "./new/index.js";
   // Add to scraperRegistry:
   new: () => new NewScraper(),
   ```
4. **Add credentials** to `.env` and `.env.example`:
   ```
   NEW_USERNAME=your_username
   NEW_PASSWORD=your_password
   ```
5. **Add to SCRAPERS**: `SCRAPERS=chase,robinhood,new`
6. **Add institution color** to `web/src/index.css`:
   ```css
   :root { --new-color: #ff6600; }
   .institution-dot.new { background: var(--new-color); }
   ```

### Scraper Interface Contract
```typescript
interface Scraper {
  readonly name: string;        // "chase", "robinhood", "fidelity"
  readonly displayName: string; // "Chase", "Robinhood", "Fidelity"
  scrape(config: ScraperConfig): Promise<ScraperResult>;
}

interface ScraperConfig {
  headless: boolean;
  slowMo: number;
  authStatePath: string;              // ".auth/chase-state.json"
  credentials: Record<string, string>; // { username: "...", password: "..." }
}

interface ScraperResult {
  institution: string;
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  cashInterest?: CashInterest;        // Optional: interest rate data
  stockLending?: StockLendingIncome;  // Optional: stock lending income
}
```

### Key Patterns for New Scrapers
- Each scraper launches its own browser via `launchBrowser(config)`, which loads saved cookies
- No shared browser instances between scrapers (they run sequentially)
- Always check `isLoggedIn()` before attempting login — skip if session valid
- Internal types (e.g. `RobinhoodAccountData`) omit `institution` — it's added by the scraper's `scrape()` method
- Wrap each scraping step in try/catch so partial failures don't lose all data
- Use `parseBalance()` from `../utils.js` for dollar amounts — handles `$`, commas, Unicode minus `−` (U+2212)
- Use `normalizeDate()` for date strings — handles `MM/DD/YYYY` and `"Feb 20, 2026"` formats

### Credential Convention
Env vars follow `${SCRAPER_NAME_UPPER}_${KEY}` pattern:
- `CHASE_USERNAME`, `CHASE_PASSWORD`
- `ROBINHOOD_USERNAME`, `ROBINHOOD_PASSWORD`
- `FIDELITY_USERNAME`, `FIDELITY_PASSWORD`

The config loader (`loadScraperConfig` in `config.ts`) automatically strips the prefix and lowercases keys into `credentials.username`, `credentials.password`, etc.

---

## Type System (`src/types.ts`)

### Core Types
```typescript
AccountType = "checking" | "savings" | "credit" | "investment" | "brokerage" | "other"
Account     = { name, type, currentBalance, availableBalance?, accountNumber, institution }
Transaction = { date (YYYY-MM-DD), description, amount, category?, isPending, accountName, institution }
Holding     = { ticker, name, shares, currentPrice, currentValue, costBasis, gainLoss, gainLossPercent, institution }
CashInterest      = { apy, cashEarningInterest, interestAccruedThisMonth, lifetimeInterestPaid }
StockLendingIncome = { lastMonth, total, stocksOnLoan: { ticker, name, shares }[] }
```

### Extending Types for New Data
When adding new scraper-specific data (like interest rates, lending income, etc.):
1. Add the interface to `src/types.ts`
2. Add as **optional** field on both `ScraperResult` and `ScrapeResult`
3. Merge in `src/index.ts` orchestrator (after the `for` loop over scrapers)
4. Pass through in `web/src/hooks/useData.ts` normalize function
5. Consume conditionally in dashboard components (`{data.newField && <Component />}`)

---

## Dashboard Architecture

### Layout Structure (Overview tab)
`Dashboard.tsx` sections render in this order:
1. **Net Worth Banner** — total balance, cash/investments/return breakdown
2. **Institution Sections** — account cards grouped by `groupBy(accounts, a => a.institution)`
3. **Stats Row** — income, spending, transaction count, portfolio value, cost basis, positions
4. **Passive Income Grid** — cash interest card (with APY badge) + stock lending card (with ticker pills)
5. **Portfolio Grid** — top holdings by value (allocation bars) + top movers (gainers/losers)
6. **Monthly Cash Flow** — bar chart from SpendingChart component

### Adding New Dashboard Sections
- Add components inline in `Dashboard.tsx` or as separate files if complex
- Wrap in conditional: `{data.newField && <NewSection data={data.newField} />}`
- Use the CSS variable system (`--surface`, `--border`, `--positive`, `--negative`, etc.)
- Card pattern: `background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px;`
- Grid: `display: grid; grid-template-columns: 1fr 1fr;` with responsive `1fr` at `max-width: 900px`

### CSS Variables (Dark Theme)
```css
--bg: #0f1117           --surface: #1a1d27      --surface-hover: #222632
--border: #2a2e3a       --text: #e4e4e7         --text-muted: #8b8d97
--accent: #3b82f6       --positive: #22c55e     --negative: #ef4444
--checking: #3b82f6     --savings: #22c55e      --brokerage: #8b5cf6
--credit: #f59e0b       --investment: #06b6d4
--chase-color: #0060f0  --robinhood-color: #00c805  --fidelity-color: #4a8c3f
```

When adding a new institution, add `--{name}-color` and `.institution-dot.{name}` rule.

### Shared Types in Web
Web imports types from `@shared/types` — a Vite alias to `../src`. No separate web type definitions needed.

---

## Selector Discovery Workflow
When scraping a new institution:
1. Write `src/debug-{name}.ts` that visits key pages in headed mode (`headless: false`)
2. Dump `data-testid` elements, tables, headings, links, and dollar amounts to JSON
3. Take full-page screenshots for visual reference
4. Analyze dumps to identify reliable selectors
5. **Selector strategy** (in order of reliability):
   - `data-testid` attributes (most stable across deployments)
   - Semantic HTML (`table`, `h1`-`h4`, `a[href^="/path/"]`)
   - Text content matching (`button:has-text("...")`)
   - ARIA attributes (`[aria-label="..."]`, `[role="menuitem"]`)
   - **Avoid** CSS class selectors (dynamic/emotion classes change between builds)
6. Run with `npx tsx src/debug-{name}.ts`, headed mode, verify selectors work
7. Clean up debug scripts after selectors are confirmed and scraper is working

---

## Chase-Specific Reference

### Login Page
- **URL**: `https://secure.chase.com/web/auth/#/logon/logon/chaseOnline`
- **No iframe** — form is directly on the page
- Username: `#userId-input-field-input`
- Password: `#password-input-field-input`
- Remember me: `#rememberMe` (needs `force: true` — SVG overlay intercepts clicks)
- Sign in: `#signin-button`
- 2FA redirect URL contains: `caas/challenge`
- Dashboard URL after login: `#/dashboard/overview`

### Dashboard
- Account tiles: `[data-testid="accountTile"]`
- Account name: `<mds-button>` inside `[data-testid="accounts-name-link"]` — name is in the `text` **attribute**
- Balances: first `$X,XXX.XX` match in tile `textContent`
- Negative amounts use Unicode minus `−` (U+2212) — parse with `.replace(/\u2212/g, "-")`

### Account Detail Page
- URL: `#/dashboard/summary/{accountId}/DDA/CHK` (or `SAV`)
- Transaction table: `tr[id*="ACTIVITY-dataTableId-row-"]` (header row ends in `column-headers`)
- Table needs **5-8 seconds** to render after SPA navigation
- CSV download button: `data-testid="quick-action-download-activity-tooltip-button"`
- Download modal: `<mds-button text="Download">` — click via shadow DOM `.evaluate()`
- CSV descriptions have extra whitespace — clean with `.replace(/\s{2,}/g, " ")`
- Savings accounts may lack download button if no transaction history

### Web Component Patterns (mds-button)
- **Read attributes**: `el.getAttribute("text")` — name is in `text` attribute, not textContent
- **Click**: Must use `.evaluate()` to reach into `shadowRoot` and click inner `<button>`
- **Find**: `page.locator('mds-button[text*="..."]')`
- `page.waitForLoadState("networkidle")` hangs after clicking — use `page.waitForURL()` instead

---

## Robinhood-Specific Reference

### Login Page
- **URL**: `https://robinhood.com/login/`
- Email: `input[name="username"]`
- Password: `input#current-password`
- Submit: `button[type="submit"]`
- 2FA: device approval notification — poll until URL changes from `/login`
- Login detection: check for `[data-testid="PortfolioValue"]`

### Portfolio Page (Home)
- **Portfolio value**: `h2[data-testid="PortfolioValue"]` — text has animation chars, extract first `$X,XXX.XX`
- **Buying power**: `button:has-text("Buying power")` — text: `"Buying power$XXX,XXX.XX"`

### Account/Holdings Page (`/account/investing`)
- **Full holdings table**: All positions with complete data
- **Stock links**: `a[href^="/stocks/"]` — text: `"{Name}{TICKER}{shares}${price}${avgCost}${totalReturn}${equity}"`
- **Crypto links**: `a[href^="/crypto/"]` — same format
- **Parsing**: Extract ticker from href, split text by `ticker + digit` regex, split data by `$`
- **Cash table** (table index 2): `"Individual Cash$X,XXX.XXWithdrawable Cash$X,XXX.XX"`
- **Interest table** (table index 3): `"Annual percentage yield (APY)X.XX%Cash earning interest$X,XXX.XXInterest accrued this month$XX.XXLifetime interest paid$X,XXX.XX"`
- **Margin table** (table index 0): margin used, maintenance, day trade limit

### History Page (`/account/history`)
- Activity items: `[data-testid="activity-item"]` with expandable accordion
- Header: `[data-testid="rh-ExpandableItem-buttonContent"]` contains h3 elements (description + amount)
- Detail fields: `[data-testid="cell-label"]` (Symbol, Type, Submitted, Filled, Quantity, Notional)
- Infinite scroll: `[data-testid="infinite-scroll-detector"]` — scroll to load more
- Transfer items: `[data-testid="UnifiedTransferActivityItem"]`
- Types: Market Buy, Market Sell, Dividend, Deposit, Withdrawal, Stock Lending Payment

### Stock Lending Page (`/account/stock-lending`)
- Income amounts in `h2` elements: first = last month, second = total
- Stocks on loan: `a[href^="/stocks/"]` with text containing "share(s)"

### Robinhood Gotchas
- Uses emotion CSS classes (dynamic, unreliable) — always prefer `data-testid` or link hrefs
- `waitUntil: "networkidle"` hangs on SPA — use `"domcontentloaded"` instead
- **Use `/account/investing` for holdings, NOT the sidebar** — sidebar is virtualized (only shows ~15 visible)
- Credit card has NO web interface (mobile app only)
- Portfolio value text has animation artifacts — always regex extract first valid dollar amount
- `waitForSelector` with `state: "attached"` instead of `"visible"` for elements that may be hidden

### Robinhood Pages with No Useful Scrapeable Data
- `/cash` (Spending) — Empty if no Robinhood Cash Card
- `/retirement` — Redirects to signup if no IRA
- `/account/recurring` — Empty if no active recurring buys
- `/account/tax-center` — IRA promo only, no inline tax docs
- `/account/reports-statements` — Links to report categories but no inline data

---

## Fidelity-Specific Reference

### Login Page
- **URL**: `https://digital.fidelity.com/prgw/digital/login/full-page`
- Username: `#dom-username-input` (pvd-input component)
- Password: `#dom-pswd-input` (pvd-input component)
- Submit: `#dom-login-button`
- 2FA: Push notification via `#dom-push-primary-button`
- Trust device: `#dom-trust-device-checkbox`
- After login: `https://digital.fidelity.com/ftgw/digital/portfolio/summary`
- Login detection: `.acct-selector__all-accounts-balance`

### Portfolio Summary Page
- **URL**: `https://digital.fidelity.com/ftgw/digital/portfolio/summary`
- Account sidebar: `.acct-selector__group`
- All accounts balance: `.acct-selector__all-accounts-balance`
- Individual account balance: `.acct-selector__acct-balance`

### Positions Page
- **URL**: `https://digital.fidelity.com/ftgw/digital/portfolio/positions`
- Download: `button:has-text("Available Actions")` → `#kebabmenuitem-download`
- **CSV columns** (16): Account Number, Account Name, Symbol, Description, Quantity, Last Price, Last Price Change, Current Value, Today's G/L $, Today's G/L %, Total G/L $, Total G/L %, % Of Account, Cost Basis, Cost Basis Per Share, Type
- Tickers may have footnote markers (`SPAXX**`) — strip with `.replace(/\*+$/, "")`
- Uses CSS grid, NOT `<table>` elements

### Activity Page
- **URL**: `https://digital.fidelity.com/ftgw/digital/portfolio/activity`
- History filter: `button:has-text("History")`
- Download: `button[aria-label="Download"]`
- Date format: `Mon-DD-YYYY` (e.g., "Feb-13-2026")

### Fidelity Gotchas
- Uses `pvd-*` proprietary design system components
- Loading spinners: `.pvd-spinner__mask-inner`
- `waitUntil: "networkidle"` may hang — use `"domcontentloaded"` instead
- Positions CSV is the most reliable data source (includes all accounts/positions/cost basis)
- Activity page uses `apex-kit-web-button` components

---

## Session / Cookie Persistence
- Playwright `storageState` saves cookies + localStorage to `.auth/${scraper}-state.json`
- **Chase**: Navigate to dashboard first — if `accountTile` renders, skip login
- **Robinhood**: Navigate to `robinhood.com` first — if `PortfolioValue` renders, skip login
- **Fidelity**: Navigate to summary URL first — if `.acct-selector__all-accounts-balance` renders, skip login
- Don't navigate to Chase login URL with stale cookies — shows "Expiring..." alerts

## Anti-Detection
- `--disable-blink-features=AutomationControlled` hides `navigator.webdriver`
- Custom Chrome user agent string (real Chrome UA, not Playwright default)
- `slowMo: 50` between actions
- Session reuse minimizes login frequency

## Common Pitfalls
- Chase generic error selectors (`[class*="error"]`) match non-error elements — use specific text matching
- Chase transaction table header row has only `<th>` — check `tds.length === 0` to skip
- Always wrap account detail navigation in try/catch so other accounts still get scraped
- `parseBalance()` handles Unicode minus `−` (U+2212) — always use it instead of raw `parseFloat`
- Vite port 5173 may be in use — Vite auto-selects next available port
- TypeScript `as unknown as ScrapeResult` cast needed in useData.ts for JSON → typed object

