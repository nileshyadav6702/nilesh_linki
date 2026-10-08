import { chromium } from "playwright-extra";
import type { Browser, BrowserContext, Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getDb } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

chromium.use(StealthPlugin());

let browser: Browser | null = null;
// One in-flight launch at a time: with several account workers running in parallel, two of
// them can find `browser` null in the same tick, and each would launch (and one orphan) a
// whole Chromium process tree.
let browserLaunch: Promise<Browser> | null = null;
const contexts: Map<string, BrowserContext> = new Map();
// Per-account context creation in flight, so concurrent callers for one account share it.
const contextCreations: Map<string, Promise<BrowserContext>> = new Map();
// Last time each account's context was handed out — drives closeIdleSessions().
const lastUsedAt: Map<string, number> = new Map();

const HEADLESS = process.env.HEADLESS !== "false";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

/**
 * Shared browser-context fingerprint. Login and runtime MUST use the identical
 * options so the LinkedIn session is BORN under the exact fingerprint it will
 * later be used with — a mismatch (or a drift) triggers a forced re-auth.
 */
export function contextOptions(storageState?: object) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storageState: storageState as any,
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    permissions: ["clipboard-read", "clipboard-write"] as ("clipboard-read" | "clipboard-write")[],
  };
}

export async function getBrowser(headless = HEADLESS): Promise<Browser> {
  // B1: if the cached browser is disconnected, CLOSE it before relaunching.
  // Without this, a dead-but-not-reaped chromium process tree is orphaned on
  // every relaunch (the leak behind the Jun 2026 zombie pile-up).
  if (browser && !browser.isConnected()) {
    try { await browser.close(); } catch { /* already gone */ }
    browser = null;
  }
  if (browser) return browser;
  if (!browserLaunch) {
    browserLaunch = (async () => {
      try {
        browser = await chromium.launch({
          headless,
          executablePath: CHROMIUM_PATH,
          args: LAUNCH_ARGS,
        });
        return browser;
      } finally {
        browserLaunch = null;
      }
    })();
  }
  return browserLaunch;
}

async function getOrCreateContext(accountId: string): Promise<BrowserContext> {
  lastUsedAt.set(accountId, Date.now());
  const existing = contexts.get(accountId);
  if (existing) return existing;
  let creation = contextCreations.get(accountId);
  if (!creation) {
    creation = createContext(accountId).finally(() => contextCreations.delete(accountId));
    contextCreations.set(accountId, creation);
  }
  return creation;
}

async function createContext(accountId: string): Promise<BrowserContext> {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | { cookies_json: string | null; email: string }
    | undefined;

  if (!account) throw new Error(`Account ${accountId} not found`);

  const b = await getBrowser();

  let storageState: object | undefined;
  if (account.cookies_json) {
    try {
      storageState = JSON.parse(decryptSecret(account.cookies_json)!);
    } catch {
      // Invalid storage state — will need re-auth
    }
  }

  const ctx = await b.newContext(contextOptions(storageState));

  // Auto-evict from map when context closes for any reason (crash, session expiry, etc.)
  ctx.on("close", () => { if (contexts.get(accountId) === ctx) contexts.delete(accountId); });

  contexts.set(accountId, ctx);
  return ctx;
}

/** Returns the BrowserContext for an account (for API calls via ctx.request) */
export async function getSessionContext(accountId: string): Promise<BrowserContext> {
  try {
    return await getOrCreateContext(accountId);
  } catch {
    // First attempt failed — evict and retry once with a fresh context
    contexts.delete(accountId);
    return getOrCreateContext(accountId);
  }
}

/** Returns a new Page from the account's browser context */
export async function getSessionPage(accountId: string): Promise<Page> {
  const ctx = await getOrCreateContext(accountId);
  try {
    return await ctx.newPage();
  } catch {
    // B2: context was dead — CLOSE it before recreating so its underlying
    // browser process isn't left orphaned, then retry once with a fresh one.
    try { await ctx.close(); } catch { /* already gone */ }
    contexts.delete(accountId);
    const freshCtx = await getOrCreateContext(accountId);
    return freshCtx.newPage();
  }
}

export async function saveSessionState(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (!ctx) return;
  const db = getDb();
  const state = await ctx.storageState();
  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encryptSecret(JSON.stringify(state)),
    accountId
  );
}

export async function closeSession(accountId: string): Promise<void> {
  const ctx = contexts.get(accountId);
  if (ctx) {
    await ctx.close();
    contexts.delete(accountId);
  }
  lastUsedAt.delete(accountId);
}

/** Accounts with an open browser context (for memory accounting and tests). */
export function openSessionAccountIds(): string[] {
  return Array.from(contexts.keys());
}

/**
 * Close the contexts of accounts that have not used the browser for `idleMs`, saving their
 * cookies first. Each context costs roughly 150-300 MB, so with parallel account workers an
 * idle account must not keep one open forever. `busy` accounts are never touched: their
 * worker (or a step it abandoned on a timeout) may still be driving the context.
 */
export async function closeIdleSessions(idleMs: number, busy: ReadonlySet<string> = new Set()): Promise<string[]> {
  const closed: string[] = [];
  const now = Date.now();
  for (const accountId of Array.from(contexts.keys())) {
    if (busy.has(accountId) || contextCreations.has(accountId)) continue;
    if (now - (lastUsedAt.get(accountId) ?? 0) < idleMs) continue;
    try {
      const authed = getDb().prepare("SELECT is_authenticated FROM accounts WHERE id = ?").get(accountId) as { is_authenticated: number } | undefined;
      // Never re-flag a logged-out account as authenticated by saving its dead session.
      if (authed?.is_authenticated) await saveSessionState(accountId);
    } catch (err) {
      console.warn(`[session] could not save state for idle account ${accountId}:`, err instanceof Error ? err.message : err);
    }
    try { await closeSession(accountId); closed.push(accountId); } catch { contexts.delete(accountId); }
  }
  return closed;
}

/**
 * B4: flag an account as logged out / needing re-auth. Clears is_authenticated
 * so the runner stops working a dead session (no more 30s-timeout fail-loop),
 * and drops the live context. The user re-authenticates from Settings.
 */
export async function markNeedsReauth(accountId: string): Promise<void> {
  const db = getDb();
  db.prepare("UPDATE accounts SET is_authenticated = 0 WHERE id = ?").run(accountId);
  try { await closeSession(accountId); } catch { /* ignore */ }
  console.warn(`[session] account ${accountId} flagged needs-reauth (session logged out)`);
}

/**
 * Opens a visible browser, navigates to LinkedIn login, and waits for the user
 * to complete login manually. Returns when the user reaches /feed.
 * Saves the full storage state to DB and marks account as authenticated.
 */
export async function authenticateAccount(accountId: string): Promise<void> {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | { email: string }
    | undefined;
  if (!account) throw new Error(`Account ${accountId} not found`);

  // Close any existing context for this account — start fresh
  await closeSession(accountId);

  // Always launch a VISIBLE browser for manual login
  const visibleBrowser = await chromium.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const ctx = await visibleBrowser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/login");

    // Pre-fill email to save the user a step
    try {
      await page.waitForSelector("input#username", { timeout: 5000 });
      await page.fill("input#username", account.email);
    } catch {
      // Input not found — page may have redirected already
    }

    // Wait up to 3 minutes for the user to complete login and reach /feed
    await page.waitForURL("**/feed/**", { timeout: 180_000 });

    // Save full storage state (cookies + localStorage) to DB
    const state = await ctx.storageState();
    db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
      encryptSecret(JSON.stringify(state)),
      accountId
    );

    await ctx.close();
  } finally {
    await visibleBrowser.close();
  }
}

// Server-side headless login lives in session-login.ts; re-exported so callers keep one import.
export { startHeadlessLogin, submitLoginChallenge, awaitLoginApproval, type LoginResult } from "@/lib/linkedin/session-login";
