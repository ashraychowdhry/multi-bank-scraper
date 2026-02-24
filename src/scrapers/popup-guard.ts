import type { Page, Locator } from "playwright";

/** Result of a popup dismissal attempt */
export interface PopupDismissResult {
  dismissed: boolean;
  method: "close-button" | "escape-key" | "none";
  selector?: string;
  description?: string;
}

export interface DismissPopupOptions {
  /** Scraper name for log prefixing */
  scraperName?: string;
}

export interface PopupRetryOptions extends DismissPopupOptions {
  /** Maximum retry attempts after popup dismissal. Default: 2 */
  maxRetries?: number;
}

// Close button text patterns (matched case-insensitively)
const CLOSE_BUTTON_TEXTS = [
  "close",
  "dismiss",
  "got it",
  "skip",
  "no thanks",
  "not now",
  "maybe later",
  "continue",
  "ok",
  "okay",
  "i understand",
  "accept",
  "decline",
  "cancel",
  "explore on my own",
  "remind me later",
];

// Selectors for legitimate UI that must NOT be dismissed
const PROTECTED_SELECTORS = [
  'input[type="password"]',
  'input[type="tel"]',
  'input[name*="user" i]',
  'input[name*="otp" i]',
  'input[name*="code" i]',
  "#userId-input-field-input", // Chase
  "#password-input-field-input", // Chase
  'input[name="username"]', // Robinhood
  "input#current-password", // Robinhood
  "#dom-username-input", // Fidelity
  "#dom-pswd-input", // Fidelity
  "#dom-push-primary-button", // Fidelity 2FA
  "#eliloUserID", // Amex
  "#eliloPassword", // Amex
];

// Known institution-specific popup patterns
const KNOWN_PATTERNS = [
  {
    description: "Fidelity custom columns banner",
    selector: 'button[aria-label="Close"]',
  },
  {
    description: "Amex onboarding modal",
    selector:
      '[data-testid="myca-activity-onboarding-modal/explore-on-my-own"]',
  },
  {
    description: "Cookie consent accept",
    selector:
      'button[id*="cookie" i]:has-text("Accept"), button[id*="consent" i]:has-text("Accept")',
  },
];

function log(scraperName: string, msg: string) {
  console.log(`[${scraperName}:popup-guard] ${msg}`);
}

/**
 * Check if a locator contains protected content (login/2FA inputs)
 * that should NOT be dismissed.
 */
async function containsProtectedContent(container: Locator): Promise<boolean> {
  for (const sel of PROTECTED_SELECTORS) {
    const count = await container.locator(sel).count().catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}

/**
 * Try to find and click a close button within a container element.
 */
async function findAndClickCloseButton(
  container: Locator,
  page: Page,
  scraperName: string
): Promise<PopupDismissResult> {
  // Strategy 1: aria-label close buttons
  const ariaLabels = ["close", "dismiss", "close dialog", "close modal"];
  for (const label of ariaLabels) {
    const btn = container
      .locator(
        `button[aria-label="${label}" i], [role="button"][aria-label="${label}" i]`
      )
      .first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      log(scraperName, `Clicking close button (aria-label="${label}")`);
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return { dismissed: true, method: "close-button", selector: `[aria-label="${label}"]` };
    }
  }

  // Strategy 2: text-content close buttons
  for (const text of CLOSE_BUTTON_TEXTS) {
    const btn = container
      .locator(
        `button:has-text("${text}"), a:has-text("${text}"), [role="button"]:has-text("${text}")`
      )
      .first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      // Verify the button text is short (not "Close Account" etc.)
      const actualText = (await btn.textContent().catch(() => "")) || "";
      if (actualText.trim().length < text.length + 20) {
        log(scraperName, `Clicking close button ("${actualText.trim()}")`);
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        return {
          dismissed: true,
          method: "close-button",
          description: actualText.trim(),
        };
      }
    }
  }

  // Strategy 3: Escape key
  log(scraperName, "No close button found in dialog, trying Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  return { dismissed: true, method: "escape-key" };
}

/**
 * Phase 1: Check for ARIA dialog/modal elements (highest confidence).
 */
async function tryDismissAriaDialogs(
  page: Page,
  scraperName: string
): Promise<PopupDismissResult> {
  const dialogLocator = page.locator(
    '[role="dialog"]:visible, [role="alertdialog"]:visible, [aria-modal="true"]:visible'
  );

  const count = await dialogLocator.count().catch(() => 0);
  if (count === 0) return { dismissed: false, method: "none" };

  for (let i = 0; i < count; i++) {
    const dialog = dialogLocator.nth(i);
    if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false)))
      continue;

    if (await containsProtectedContent(dialog)) {
      log(scraperName, "Skipping dialog — contains login/2FA elements");
      continue;
    }

    log(scraperName, "Found ARIA dialog, attempting dismissal...");
    const result = await findAndClickCloseButton(dialog, page, scraperName);
    if (result.dismissed) return result;
  }

  return { dismissed: false, method: "none" };
}

/**
 * Phase 2: Try known institution-specific popup patterns.
 */
async function tryKnownPatterns(
  page: Page,
  scraperName: string
): Promise<PopupDismissResult> {
  for (const pattern of KNOWN_PATTERNS) {
    try {
      const el = page.locator(pattern.selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        log(scraperName, `Dismissing: ${pattern.description}`);
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(300);
        return {
          dismissed: true,
          method: "close-button",
          selector: pattern.selector,
          description: pattern.description,
        };
      }
    } catch {
      // Pattern not present
    }
  }

  return { dismissed: false, method: "none" };
}

/**
 * Phase 3: Heuristic overlay detection via DOM inspection.
 * Finds fixed/absolute positioned elements with high z-index covering
 * a significant portion of the viewport.
 */
async function tryHeuristicOverlayDetection(
  page: Page,
  scraperName: string
): Promise<PopupDismissResult> {
  const overlays = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewportArea = vw * vh;

    const results: Array<{
      zIndex: number;
      coverage: number;
      hasCloseButton: boolean;
      closeButtonSelector: string;
      containsInput: boolean;
      text: string;
    }> = [];

    for (const el of document.querySelectorAll("div, section, aside, nav")) {
      const style = window.getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "absolute") continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (parseFloat(style.opacity || "1") < 0.1) continue;

      const z = parseInt(style.zIndex, 10);
      if (isNaN(z) || z < 100) continue;

      const rect = (el as HTMLElement).getBoundingClientRect();
      const coverage = (rect.width * rect.height) / viewportArea;
      if (coverage < 0.15) continue;

      const containsInput =
        el.querySelectorAll(
          'input[type="password"], input[type="text"], input[type="tel"], input[type="email"]'
        ).length > 0;

      // Look for close buttons inside
      let hasCloseButton = false;
      let closeButtonSelector = "";

      // Check aria-label close buttons
      const ariaClose = el.querySelector(
        'button[aria-label="Close" i], button[aria-label="close" i], button[aria-label="Dismiss" i]'
      );
      if (ariaClose) {
        hasCloseButton = true;
        closeButtonSelector = 'button[aria-label="Close" i]';
      }

      // Check text-based close buttons
      if (!hasCloseButton) {
        const closeTexts = [
          "close", "dismiss", "got it", "skip", "no thanks",
          "not now", "maybe later", "ok", "okay", "cancel",
        ];
        for (const btn of el.querySelectorAll("button, a, [role='button']")) {
          const text = (btn.textContent || "").trim().toLowerCase();
          if (closeTexts.some((ct) => text === ct)) {
            hasCloseButton = true;
            closeButtonSelector = `button:has-text("${btn.textContent?.trim()}")`;
            break;
          }
        }
      }

      // Check for X/× icon buttons
      if (!hasCloseButton) {
        for (const btn of el.querySelectorAll("button")) {
          const text = (btn.textContent || "").trim();
          if (/^[Xx\u00D7\u2715\u2716\u2717\u2718]$/.test(text)) {
            hasCloseButton = true;
            closeButtonSelector = "button";
            break;
          }
          // SVG-only close button
          if (text === "" && btn.querySelector("svg")) {
            const btnRect = btn.getBoundingClientRect();
            if (btnRect.width < 60 && btnRect.height < 60) {
              hasCloseButton = true;
              closeButtonSelector = "button:has(svg)";
              break;
            }
          }
        }
      }

      results.push({
        zIndex: z,
        coverage,
        hasCloseButton,
        closeButtonSelector,
        containsInput,
        text: (el.textContent || "").slice(0, 200),
      });
    }

    // Topmost overlay first
    results.sort((a, b) => b.zIndex - a.zIndex);
    return results;
  });

  for (const overlay of overlays) {
    if (overlay.containsInput) {
      log(
        scraperName,
        `Skipping overlay (z-index: ${overlay.zIndex}, coverage: ${(overlay.coverage * 100).toFixed(0)}%) — contains input fields`
      );
      continue;
    }

    if (overlay.hasCloseButton) {
      log(
        scraperName,
        `Dismissing overlay (z-index: ${overlay.zIndex}, coverage: ${(overlay.coverage * 100).toFixed(0)}%) via ${overlay.closeButtonSelector}`
      );
      try {
        const closeBtn = page.locator(overlay.closeButtonSelector).first();
        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeBtn.click({ timeout: 2000 });
          await page.waitForTimeout(300);
          return {
            dismissed: true,
            method: "close-button",
            selector: overlay.closeButtonSelector,
            description: overlay.text.slice(0, 80),
          };
        }
      } catch {
        // Fall through to Escape
      }
    }

    // No close button or click failed — try Escape
    log(
      scraperName,
      `Overlay detected (z-index: ${overlay.zIndex}) — trying Escape`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Verify the overlay is gone
    const stillPresent = await page.evaluate((zIdx) => {
      for (const el of document.querySelectorAll("div, section, aside")) {
        const style = window.getComputedStyle(el);
        if (
          parseInt(style.zIndex, 10) === zIdx &&
          (style.position === "fixed" || style.position === "absolute") &&
          style.display !== "none"
        ) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      }
      return false;
    }, overlay.zIndex);

    if (!stillPresent) {
      return { dismissed: true, method: "escape-key", description: overlay.text.slice(0, 80) };
    }
  }

  return { dismissed: false, method: "none" };
}

/**
 * Detect and dismiss unexpected popups/modals/overlays on the page.
 *
 * Runs through three phases:
 * 1. ARIA dialog elements (role="dialog", aria-modal)
 * 2. Known institution-specific popup patterns
 * 3. Heuristic: fixed/absolute overlays with high z-index
 *
 * Will NOT dismiss elements containing login/2FA inputs.
 */
export async function dismissPopups(
  page: Page,
  options: DismissPopupOptions = {}
): Promise<PopupDismissResult> {
  const scraperName = options.scraperName || "popup-guard";

  // Phase 1: ARIA dialogs
  const ariaResult = await tryDismissAriaDialogs(page, scraperName);
  if (ariaResult.dismissed) return ariaResult;

  // Phase 2: Known patterns
  const knownResult = await tryKnownPatterns(page, scraperName);
  if (knownResult.dismissed) return knownResult;

  // Phase 3: Heuristic overlay detection
  const heuristicResult = await tryHeuristicOverlayDetection(page, scraperName);
  if (heuristicResult.dismissed) return heuristicResult;

  return { dismissed: false, method: "none" };
}

/**
 * Retry an operation after dismissing popups.
 *
 * 1. Run fn() — return immediately if successful (zero overhead)
 * 2. On failure: try Escape, retry
 * 3. On second failure: run full dismissPopups(), retry if popup found
 * 4. If no popup found, throw the original error
 */
export async function withPopupRetry<T>(
  page: Page,
  fn: () => Promise<T>,
  options: PopupRetryOptions = {}
): Promise<T> {
  const { maxRetries = 2, scraperName = "popup-guard" } = options;

  // First attempt — no overhead
  try {
    return await fn();
  } catch (firstError) {
    log(scraperName, `Operation failed: ${(firstError as Error).message?.slice(0, 100)}`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(scraperName, `Retry ${attempt}/${maxRetries} — checking for popups...`);

    // First retry: try Escape (fastest)
    if (attempt === 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      try {
        return await fn();
      } catch {
        log(scraperName, "Escape didn't help, running full popup detection...");
      }
    }

    // Full popup dismissal
    const result = await dismissPopups(page, { scraperName });
    if (result.dismissed) {
      log(scraperName, `Popup dismissed (${result.method}), retrying...`);
      await page.waitForTimeout(500);
      try {
        return await fn();
      } catch (retryError) {
        log(scraperName, `Retry ${attempt} still failed: ${(retryError as Error).message?.slice(0, 100)}`);
      }
    } else {
      log(scraperName, "No popup detected — failure is not popup-related.");
      break;
    }
  }

  // All retries exhausted — let the original error propagate
  return await fn();
}

/**
 * Proactive popup sweep after page navigation.
 * Call this after page.goto() to catch popups that appear on page load.
 * Loops up to maxSweeps times to catch stacked/sequential popups.
 */
export async function afterNavigation(
  page: Page,
  options: DismissPopupOptions & { maxSweeps?: number } = {}
): Promise<void> {
  const maxSweeps = options.maxSweeps ?? 3;
  const name = options.scraperName || "popup-guard";

  await page.waitForTimeout(1000);

  for (let i = 0; i < maxSweeps; i++) {
    const result = await dismissPopups(page, options);
    if (result.dismissed) {
      log(
        name,
        `Auto-dismissed popup after navigation (${result.method}${result.description ? `: ${result.description}` : ""})`
      );
      // Brief pause for next popup to render before sweeping again
      await page.waitForTimeout(800);
    } else {
      break;
    }
  }
}
