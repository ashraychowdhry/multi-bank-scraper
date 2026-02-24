import { chromium, BrowserContext, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScraperConfig } from "./interface.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser(config: ScraperConfig) {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const contextOptions = {
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 } as const,
  };

  let context: BrowserContext;
  if (fs.existsSync(config.authStatePath)) {
    console.log(`Loading saved session from ${config.authStatePath}...`);
    context = await browser.newContext({
      ...contextOptions,
      storageState: config.authStatePath,
    });
  } else {
    context = await browser.newContext(contextOptions);
  }

  // Protect eval from being monkeypatched by sites like Amex.
  // Their app.js overrides window.eval which breaks Playwright's $$eval/evaluate.
  await context.addInitScript(() => {
    const nativeEval = window.eval;
    Object.defineProperty(window, "eval", {
      value: nativeEval,
      writable: false,
      configurable: false,
    });
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function saveSession(
  context: BrowserContext,
  authStatePath: string
): Promise<void> {
  const dir = path.dirname(authStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: authStatePath });
  console.log(`Session saved to ${authStatePath}`);
}
