import type { BrowserContext, Page } from "playwright";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { closeSession, contextOptions, getBrowser } from "@/lib/linkedin/session";
import { accountProxy } from "@/lib/linkedin/proxy";

// ─── Server-side headless login ───────────────────────────────────────────────
// Logs in directly on the server (no screen) so the session is born under the
// SAME pinned Chromium fingerprint the runner uses, and so ALL cookies — incl.
// httpOnly ones like li_ep_auth_context (the Sales Nav seat cookie that
// document.cookie cannot read) — are captured. A login from a datacenter IP
// almost always triggers an email/SMS PIN, so it's a two-step flow: start
// (email+password) → maybe a challenge → verify (code).

export type LoginResult =
  | { status: "authenticated" }
  | { status: "challenge"; kind: "otp" | "app" | "captcha" | "unknown"; message: string }
  | { status: "error"; message: string };

type PendingLogin = { ctx: BrowserContext; page: Page; createdAt: number };
const pendingLogins: Map<string, PendingLogin> = new Map();
const PENDING_TTL_MS = 10 * 60_000;

// PIN/verification-code input. Named ids first, then type-based fallbacks for
// LinkedIn's React checkpoint pages (which use dynamic ids). Safe: the login
// page itself has no tel/one-time-code input to misfire on.
const PIN_SELECTOR =
  "input[name='pin'], #input__email_verification_pin, input[autocomplete='one-time-code']:visible, input[type='tel']:visible";

async function clearPendingLogin(accountId: string): Promise<void> {
  const p = pendingLogins.get(accountId);
  if (p) {
    pendingLogins.delete(accountId);
    try { await p.ctx.close(); } catch { /* already gone */ }
  }
}

function sweepPendingLogins(): void {
  const now = Date.now();
  for (const [id, p] of pendingLogins) {
    if (now - p.createdAt > PENDING_TTL_MS) void clearPendingLogin(id);
  }
}

/**
 * Warm the freshly-authenticated session by loading Sales Navigator once, THEN
 * persist. The bare login POST lands on /feed and only mints the ~11 core
 * LinkedIn cookies — it does NOT yet include the Sales Nav SEAT cookie
 * (li_ep_auth_context) nor the secondary auth tokens (li_a, liap) and
 * localStorage. Those are only issued once the browser actually enters Sales
 * Navigator. Without the seat cookie every Sales Nav API call returns nothing
 * ("no intercept after 15s" → import fails → account wrongly flagged
 * needs-reauth). So we navigate to /sales/ and wait for it to settle before
 * calling storageState(), capturing the FULL session the runner needs.
 * Best-effort: if the account has no Sales Nav seat the nav simply doesn't add
 * the seat cookie — the rest of the (regular-LinkedIn) session is still saved.
 */
async function persistLogin(accountId: string, ctx: BrowserContext, page?: Page): Promise<void> {
  if (page) {
    try {
      await page.goto("https://www.linkedin.com/sales/home", { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Let Sales Nav's bootstrap requests fire so li_ep_auth_context is set.
      await page.waitForTimeout(4_000);
    } catch {
      // Non-fatal — a missing seat / slow load must not fail the whole login.
    }
  }
  const db = getDb();
  const state = await ctx.storageState();
  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encryptSecret(JSON.stringify(state)),
    accountId
  );
  // Pull the account's LinkedIn conversations into the inbox right away.
  void import("@/lib/inbox/sync").then((m) => m.queueInboxSync("linkedin", accountId)).catch(() => {});
  // Drop any stale runtime context so the runner reloads the fresh cookies.
  await closeSession(accountId);
}

/**
 * Inspect the page after a login/verify submit and classify the outcome.
 * LinkedIn varies its challenge per attempt — email/SMS code OR device (app)
 * approval — so we detect both: a visible code input = otp; a checkpoint page
 * with no code input and no captcha = device approval.
 */
async function classifyLoginState(page: Page): Promise<LoginResult> {
  const start = Date.now();
  const deadline = start + 20_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/\/feed\//.test(url) || /linkedin\.com\/sales\//.test(url)) {
      return { status: "authenticated" };
    }

    // Email/SMS PIN entry
    const pin = page.locator(PIN_SELECTOR).first();
    if ((await pin.count()) > 0 && (await pin.isVisible().catch(() => false))) {
      return {
        status: "challenge",
        kind: "otp",
        message: "LinkedIn sent you a verification code (email or SMS). Enter it below.",
      };
    }

    if (/checkpoint\/challenge/.test(url)) {
      // CAPTCHA (Arkose / FunCaptcha) — cannot be solved headlessly
      const cap = page.locator("iframe[src*='arkoselabs'], iframe[title*='captcha'], #captcha-internal");
      if ((await cap.count().catch(() => 0)) > 0) {
        return {
          status: "challenge",
          kind: "captcha",
          message: "LinkedIn requires a CAPTCHA, which can't be solved on the server. Use cookie paste instead.",
        };
      }
      // Device/app approval: a settled checkpoint with no code input and no captcha
      if (Date.now() - start > 4_000) {
        return {
          status: "challenge",
          kind: "app",
          message: "LinkedIn sent a sign-in request to your LinkedIn mobile app. Approve it there, then click Continue.",
        };
      }
    }

    // Wrong credentials
    const wrongPw = await page
      .getByText(/that.?s not the right password|please enter a valid|couldn.?t find a linkedin account/i)
      .count()
      .catch(() => 0);
    if (wrongPw > 0) return { status: "error", message: "Wrong email or password." };

    await page.waitForTimeout(800);
  }

  if (/checkpoint/.test(page.url())) {
    return {
      status: "challenge",
      kind: "unknown",
      message: "LinkedIn presented a security checkpoint. If you got a code enter it; if it's an app request, approve it and click Continue.",
    };
  }
  return { status: "error", message: `Login did not complete. Current page: ${page.url()}` };
}

export async function startHeadlessLogin(
  accountId: string,
  email: string,
  password: string
): Promise<LoginResult> {
  sweepPendingLogins();
  await clearPendingLogin(accountId);

  const b = await getBrowser(true);
  const ctx = await b.newContext(contextOptions(undefined, accountProxy(accountId)));
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    // LinkedIn's React login page uses dynamic ids — target by type+visibility
    // (old #username/#password kept as a fallback for the legacy layout).
    const emailInput = page.locator("input#username, input[type='email']:visible").first();
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.fill(email);
    const passwordInput = page.locator("input#password, input[type='password']:visible").first();
    await passwordInput.fill(password);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      passwordInput.press("Enter"),
    ]);

    const result = await classifyLoginState(page);
    console.log(`[login] start account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await ctx.close();
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      pendingLogins.set(accountId, { ctx, page, createdAt: Date.now() });
      return result;
    }
    await ctx.close();
    return result;
  } catch (e) {
    console.log(`[login] start account=${accountId} ERROR ${(e as Error).message} url=${page.url()}`);
    try { await ctx.close(); } catch { /* ignore */ }
    return { status: "error", message: (e as Error).message };
  }
}

export async function submitLoginChallenge(accountId: string, code: string): Promise<LoginResult> {
  const p = pendingLogins.get(accountId);
  if (!p) return { status: "error", message: "No login in progress (it may have timed out — start again)." };

  const { ctx, page } = p;
  try {
    const pin = page.locator(PIN_SELECTOR).first();
    await pin.waitFor({ state: "visible", timeout: 15_000 });
    await pin.fill(code);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      pin.press("Enter"),
    ]);

    const result = await classifyLoginState(page);
    console.log(`[login] verify account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await clearPendingLogin(accountId);
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      p.createdAt = Date.now(); // keep the session alive for another step
      return result;
    }
    await clearPendingLogin(accountId);
    return result.status === "error"
      ? result
      : { status: "error", message: "Code rejected or login failed." };
  } catch (e) {
    await clearPendingLogin(accountId);
    return { status: "error", message: (e as Error).message };
  }
}

/**
 * Wait for a device/app-approval challenge to clear. Called after the user
 * approves the sign-in in their LinkedIn mobile app — the checkpoint page then
 * auto-advances to the feed. Also dismisses a possible "remember this browser?"
 * interstitial. If still pending, returns the challenge so the user can retry.
 */
export async function awaitLoginApproval(accountId: string): Promise<LoginResult> {
  const p = pendingLogins.get(accountId);
  if (!p) return { status: "error", message: "No login in progress (it may have timed out — start again)." };

  const { ctx, page } = p;
  p.createdAt = Date.now();
  try {
    const reachedFeed = await page
      .waitForURL(/\/feed\/|linkedin\.com\/sales\//, { timeout: 50_000 })
      .then(() => true)
      .catch(() => false);

    if (!reachedFeed) {
      // Possible post-approval interstitial (e.g. "remember this browser?")
      const btn = page
        .locator("button[type=submit]:visible, button:has-text('Yes'):visible, button:has-text('Ja'):visible")
        .first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click().catch(() => {});
        await page.waitForURL(/\/feed\/|linkedin\.com\/sales\//, { timeout: 20_000 }).catch(() => {});
      }
    }

    const result = await classifyLoginState(page);
    console.log(`[login] await account=${accountId} -> ${result.status}${"kind" in result ? "/" + result.kind : ""} url=${page.url()}`);
    if (result.status === "authenticated") {
      await persistLogin(accountId, ctx, page);
      await clearPendingLogin(accountId);
      return result;
    }
    if (result.status === "challenge" && result.kind !== "captcha") {
      p.createdAt = Date.now();
      return result;
    }
    await clearPendingLogin(accountId);
    return result;
  } catch (e) {
    await clearPendingLogin(accountId);
    return { status: "error", message: (e as Error).message };
  }
}
