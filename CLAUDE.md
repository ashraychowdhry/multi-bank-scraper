# Bank Scraper — Development Guide

## Project Overview
TypeScript + Playwright tool for scraping bank/brokerage account data (balances, transactions, holdings). Supports multiple institutions via a plugin architecture. Personal tool — no Plaid or paid services.

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
  types.ts                    # Generic: Account, Transaction, Holding, ScrapeResult
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
      accounts.ts             # Portfolio value + buying power
      holdings.ts             # Stock + crypto holdings from sidebar
web/
  src/
    App.tsx                   # Three tabs: Overview, Transactions, Holdings
    hooks/useData.ts          # Fetches /data.json, normalizes for backward compat
    components/
      Dashboard.tsx           # Overview: account cards + spending chart
      AccountCard.tsx         # Per-account card with institution badge
      TransactionTable.tsx    # Sortable transaction table with institution filter
      HoldingsTable.tsx       # Sortable holdings table with portfolio summary
      Filters.tsx             # Date/search/institution filters
      SpendingChart.tsx       # Spending category breakdown
.auth/                        # Saved Playwright session states (gitignored)
output/                       # JSON output files (gitignored)
```

## Run Commands
```bash
SCRAPERS=chase npm run scrape             # Chase only
SCRAPERS=robinhood npm run scrape         # Robinhood only
SCRAPERS=chase,robinhood npm run scrape   # Both
npm run scrape:headed                     # HEADLESS=false, visible browser
NO_DASHBOARD=true npm run scrape          # Skip dashboard launch
```

## Multi-Scraper Config
- `SCRAPERS` env var: comma-separated list of scraper names (e.g. `chase,robinhood`)
- Per-scraper credentials: `${PREFIX}_USERNAME`, `${PREFIX}_PASSWORD` (prefix = uppercase scraper name)
- Session persistence: `.auth/${name}-state.json` per scraper

## Development Workflow
- **Session persistence works** — saved cookies skip login+2FA on repeat runs
- If session is stale, delete `.auth/${scraper}-state.json` and run again
- 2FA is auto-detected by polling the URL — no terminal interaction needed
- When debugging selectors, write a temporary `src/debug-*.ts` script, run with `npx tsx`, clean up after
- Shared types between backend and web via Vite alias `@shared → ../src`

## Chase Login Page
- **URL**: `https://secure.chase.com/web/auth/#/logon/logon/chaseOnline`
- **No iframe** — form is directly on the page
- Username: `#userId-input-field-input`
- Password: `#password-input-field-input`
- Remember me: `#rememberMe` (needs `force: true` — SVG overlay intercepts clicks)
- Sign in: `#signin-button`
- 2FA redirect URL contains: `caas/challenge`
- Dashboard URL after login: `#/dashboard/overview`

## Chase Dashboard
- Account tiles: `[data-testid="accountTile"]`
- Account name: `<mds-button>` web component inside `[data-testid="accounts-name-link"]` — name is in the `text` **attribute** (e.g. `text="CHASE COLLEGE (...2885)"`)
- Balances: first `$X,XXX.XX` match in tile `textContent`
- Negative amounts use Unicode minus `−` (U+2212), not ASCII hyphen — parse with `.replace(/\u2212/g, "-")`

## Chase Account Detail Page
- URL: `#/dashboard/summary/{accountId}/DDA/CHK` (or `SAV`)
- Transaction table: `tr[id*="ACTIVITY-dataTableId-row-"]` (header row ends in `column-headers`)
- Table needs **5-8 seconds** to render after SPA navigation
- Data rows: `<th>` = date, `<td>`s = description, type, amount, balance, action
- CSV download button: `data-testid="quick-action-download-activity-tooltip-button"`
- Download modal has `<mds-button text="Download">` — click via shadow DOM `.evaluate()`
- CSV descriptions have extra whitespace — clean with `.replace(/\s{2,}/g, " ")`
- Savings accounts may lack download button if no transaction history

## Robinhood Login Page
- **URL**: `https://robinhood.com/login/`
- Email: `input[name="username"]`
- Password: `input#current-password`
- Submit: `button[type="submit"]` (text: "Log In")
- Keep logged in: `input[name="long_session"]`
- 2FA: device approval notification — poll until URL changes from `/login`
- After login, URL becomes `https://robinhood.com/?classic=1`
- Login detection: check for `[data-testid="PortfolioValue"]`

## Robinhood Portfolio Page (Home)
- **Portfolio value**: `h2[data-testid="PortfolioValue"]` — text contains animation chars, extract first `$X,XXX.XX` pattern
- **Buying power**: Button with text `"Buying power$XXX,XXX.XX"` — use `button:has-text("Buying power")`

## Robinhood Account/Holdings Page
- **URL**: `https://robinhood.com/account/investing` (redirect from `/account`)
- **Full holdings table**: All positions listed with complete data (name, ticker, shares, price, avg cost, total return, equity)
- **Stock links**: `a[href^="/stocks/"]` — text format: `"{Name}{TICKER}{shares}${price}${avgCost}${totalReturn}${equity}"`
- **Crypto links**: `a[href^="/crypto/"]` — same text format as stocks
- **Parsing**: Extract ticker from href, split text by `ticker + digit` to separate name from data, split data by `$` for fields
- **Cost basis**: Computed as `avgCostPerShare * shares`; gain/loss = `equity - costBasis`
- **Total return sign**: Page uses color (not text) for gain vs loss — compute sign from equity vs costBasis
- **Also contains**: Cash balance, margin info, APY, stock lending status

## Robinhood Gotchas
- Robinhood uses emotion CSS classes (dynamic, unreliable for selectors) — always prefer `data-testid` attributes or link hrefs
- `waitUntil: "networkidle"` can hang on Robinhood's SPA — use `"domcontentloaded"` instead
- **Use `/account/investing` for holdings, NOT the sidebar** — sidebar is virtualized and only shows ~15 visible positions
- Robinhood credit card has NO web interface (mobile app only) — cannot be scraped

## Session / Cookie Persistence
- Playwright `storageState` saves cookies + localStorage to `.auth/${scraper}-state.json`
- **Chase login strategy**: Navigate to dashboard first — if session valid, `accountTile` renders and we skip login
- **Robinhood login strategy**: Navigate to `robinhood.com` first — if `PortfolioValue` renders, skip login
- Don't navigate to Chase login URL with stale cookies — shows "Expiring..." alerts that break error detection

## Web Component Patterns (mds-button) — Chase
Chase uses `<mds-button>` web components throughout. To interact:
- **Read attributes**: `el.getAttribute("text")` — name/label is in the `text` attribute, not textContent
- **Click**: Must use `.evaluate()` to reach into `shadowRoot` and click the inner `<button>`
- **Find by content**: `page.locator('mds-button[text*="..."]')`
- `page.waitForLoadState("networkidle")` hangs after clicking web components — use `page.waitForURL()` instead

## Common Pitfalls
- Generic error selectors (`[class*="error"]`) match non-error elements like "Expiring..." → use specific text matching for credential errors
- `a[href*="account/activity"]` does not exist — dashboard links use `javascript:void(0)`
- Transaction table header row has only `<th>` (no `<td>`) — check `tds.length === 0` to skip
- Always wrap account detail navigation in try/catch so other accounts still get scraped

## Anti-Detection
- `--disable-blink-features=AutomationControlled` hides `navigator.webdriver`
- Custom Chrome user agent string (real Chrome UA, not Playwright default)
- `slowMo: 50` between actions
- Session reuse minimizes login frequency

## User's Chase Accounts
- CHASE COLLEGE (...2885) — checking
- CHASE SAVINGS (...8503) — savings
