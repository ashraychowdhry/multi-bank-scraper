# Bank Scraper — Development Guide

## Project Overview
TypeScript + Playwright tool for scraping JP Morgan Chase bank account data (balances, transactions). Personal tool — no Plaid or paid services.

## Tech Stack
- **Runtime**: Node.js with `tsx` (runs TypeScript directly, no build step)
- **Browser automation**: Playwright (Chromium only)
- **Config**: `dotenv` for credentials in `.env`
- **Module system**: ESM (`"type": "module"` in package.json)

## Project Structure
```
src/
  index.ts       # CLI entry point — orchestrates login → scrape → output
  scraper.ts     # Core logic: browser launch, login, 2FA, account/transaction scraping
  config.ts      # Loads .env, validates CHASE_USERNAME/CHASE_PASSWORD
  types.ts       # Interfaces: ChaseAccount, ChaseTransaction, ScrapeResult
.auth/           # Saved Playwright session state (gitignored)
output/          # JSON output files (gitignored)
```

## Run Commands
```bash
npm run scrape          # headless mode
npm run scrape:headed   # HEADLESS=false, visible browser (use for dev/debug)
```

## Development Workflow
- **Session persistence works** — saved cookies in `.auth/chase-state.json` skip login+2FA on repeat runs
- If session is stale, delete `.auth/` and run again (will require 2FA once)
- 2FA is auto-detected by polling the URL — no terminal interaction needed
- When debugging selectors, write a temporary `src/debug-*.ts` script, run with `npx tsx`, clean up after
- Chase's SPA loads content async — always use `waitForSelector` with generous timeouts (10-15s), never assume content is ready after navigation

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

## Account Detail Page
- URL: `#/dashboard/summary/{accountId}/DDA/CHK` (or `SAV`)
- Transaction table: `tr[id*="ACTIVITY-dataTableId-row-"]` (header row ends in `column-headers`)
- Table needs **5-8 seconds** to render after SPA navigation
- Data rows: `<th>` = date, `<td>`s = description, type, amount, balance, action
- CSV download button: `data-testid="quick-action-download-activity-tooltip-button"`
- Download modal has `<mds-button text="Download">` — click via shadow DOM `.evaluate()`
- CSV descriptions have extra whitespace — clean with `.replace(/\s{2,}/g, " ")`
- Savings accounts may lack download button if no transaction history

## Session / Cookie Persistence
- Playwright `storageState` saves cookies + localStorage to `.auth/chase-state.json`
- **Login strategy**: Navigate to dashboard first — if session valid, `accountTile` renders and we skip login
- Don't navigate to login URL with stale cookies — shows "Expiring..." alerts that break error detection
- `isLoggedIn` checks URL contains "dashboard" AND verifies `accountTile` elements render

## Web Component Patterns (mds-button)
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
