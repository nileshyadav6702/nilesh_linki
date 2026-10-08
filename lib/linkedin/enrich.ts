/**
 * Profile enrichment via Sales Navigator profile page intercept.
 *
 * Strategy: navigate to the lead's sales_nav_url. Sales Nav automatically
 * fires a salesApiProfiles call that returns the full profile — headline,
 * all positions with descriptions, degree, flagshipProfileUrl, summary.
 * We intercept that response instead of making extra API calls.
 *
 * Weight: ~5-10s per profile (one real browser page load). Run fire-and-forget
 * after import — do not await in API routes. Bulk runs charge the account's
 * profile_view discovery budget and stop on a checkpoint/authwall/login redirect.
 */
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import { consume, discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";

interface EnrichedPosition {
  title: string;
  companyName: string;
  current: boolean;
  startedOn?: { year?: number; month?: number };
  endedOn?: { year?: number; month?: number };
  description?: string;
}

interface SalesNavProfileData {
  entityUrn?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  summary?: string;
  location?: string;
  degree?: number;
  flagshipProfileUrl?: string;
  objectUrn?: string;
  positions?: EnrichedPosition[];
  skills?: Array<{ name?: string }>;
}

/** ok: stored; empty: profile had no headline/about (retry later); no_data: nothing intercepted; blocked: LinkedIn challenge. */
export type EnrichOutcome = { status: "ok" | "empty" | "no_data" | "error" } | { status: "blocked"; reason: string };

/** After this many empty reads the profile is marked enriched anyway, so it stops costing page loads. */
const MAX_EMPTY_ATTEMPTS = 3;
const emptyAttempts = new Map<string, number>();

const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

/** LinkedIn sent the session to a checkpoint, authwall or login page instead of the profile. */
export function blockedReason(url: string): string | null {
  if (/\/checkpoint\b/i.test(url)) return "LinkedIn checkpoint";
  if (/\/authwall\b/i.test(url)) return "LinkedIn authwall";
  if (/\/(uas\/)?login\b|\/signup\b|sales\/login/i.test(url)) return "LinkedIn login redirect";
  return null;
}

export async function enrichProfileDetailed(
  ctx: BrowserContext,
  target: { id: string; sales_nav_url: string; full_name: string }
): Promise<EnrichOutcome> {
  const db = getDb();
  const page = await ctx.newPage();

  try {
    // Box it so the async response listener can mutate it (TS can't narrow across async callbacks)
    const box: { data: SalesNavProfileData | null } = { data: null };

    // Intercept the salesApiProfiles call that Sales Nav fires automatically on profile load.
    // Two calls fire per page load:
    //   1st — flat object with entityUrn, headline, positions, flagshipProfileUrl (what we want)
    //   2nd — flat object with educations, skills, numOfConnections (supplementary)
    // Both are flat — no .data wrapper. Accept the first one that has entityUrn.
    page.on("response", async (resp) => {
      if (box.data) return;
      if (!resp.url().includes("salesApiProfiles")) return;
      if (resp.status() !== 200) return;
      try {
        const json = await resp.json() as Record<string, unknown>;
        if ("entityUrn" in json && "firstName" in json) {
          box.data = json as unknown as SalesNavProfileData;
        }
      } catch { /* ignore */ }
    });

    await page.goto(target.sales_nav_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const blocked = blockedReason(page.url());
    if (blocked) return { status: "blocked", reason: blocked };
    // Wait for the intercept (not a fixed 8s), then linger a human-ish, jittered moment.
    const deadline = Date.now() + jitter(8000, 4000);
    while (!box.data && Date.now() < deadline) await page.waitForTimeout(500);
    await page.waitForTimeout(jitter(1000, 2000));
    const late = blockedReason(page.url());
    if (late) return { status: "blocked", reason: late };

    const intercepted = box.data;
    if (!intercepted) {
      console.log(`[enrich] No profile data intercepted for ${target.full_name} — skipping`);
      return { status: "no_data" };
    }

    // Extract positions — include all, not just current
    const positions: EnrichedPosition[] = (intercepted.positions ?? []).map((p) => ({
      title: p.title ?? "",
      companyName: p.companyName ?? "",
      current: p.current ?? false,
      startedOn: p.startedOn,
      endedOn: p.endedOn,
      description: p.description ?? undefined,
    }));

    // Skills come from a separate decoration call — if not in intercept, skip for now
    // (the page-load intercept does not include skills; they'd need a second fetch)
    const skills: string[] = (intercepted.skills ?? [])
      .map((s) => s.name)
      .filter((n): n is string => !!n);

    const headline = intercepted.headline?.trim() || null;
    const summary = intercepted.summary?.trim() || null;
    // No headline and no about: keep enriched_profile_at empty so a later run retries,
    // up to MAX_EMPTY_ATTEMPTS, after which the profile is accepted as genuinely sparse.
    let markDone = !!(headline || summary);
    if (!markDone) {
      const n = (emptyAttempts.get(target.id) ?? 0) + 1;
      emptyAttempts.set(target.id, n);
      markDone = n >= MAX_EMPTY_ATTEMPTS;
    } else emptyAttempts.delete(target.id);

    db.prepare(`
      UPDATE targets SET
        headline            = COALESCE(?, headline),
        summary             = COALESCE(?, summary),
        positions_json      = COALESCE(?, positions_json),
        skills_json         = CASE WHEN ? IS NOT NULL THEN ? ELSE skills_json END,
        enriched_profile_at = CASE WHEN ? THEN datetime('now') ELSE enriched_profile_at END
      WHERE id = ?
    `).run(
      headline,
      summary,
      positions.length > 0 ? JSON.stringify(positions) : null,
      skills.length > 0 ? "1" : null,
      skills.length > 0 ? JSON.stringify(skills) : null,
      markDone ? 1 : 0,
      target.id
    );

    console.log(`[enrich] ${target.full_name} — ${positions.length} positions, ${skills.length} skills, headline: ${!!headline}, about: ${!!summary}`);
    return { status: headline || summary ? "ok" : "empty" };
  } catch (err) {
    console.error(`[enrich] Error enriching ${target.full_name}:`, err instanceof Error ? err.message : err);
    return { status: "error" };
  } finally {
    await page.close();
  }
}

/** Single-profile enrichment used by the runner. True when profile data was read. */
export async function enrichProfile(
  ctx: BrowserContext,
  target: { id: string; sales_nav_url: string; full_name: string }
): Promise<boolean> {
  const r = await enrichProfileDetailed(ctx, target);
  if (r.status === "blocked") console.warn(`[enrich] ${r.reason} while enriching ${target.full_name}`);
  return r.status === "ok" || r.status === "empty";
}

// ─── bulk runs: one per list and one per account at a time ─────────────────────

// On globalThis, not module scope: Next bundles API routes and instrumentation separately, so a
// module-level Set could exist twice in one process and the lock would not exclude anything.
const lockState = globalThis as typeof globalThis & { __linkiEnrichLists?: Set<string>; __linkiEnrichAccounts?: Set<string> };
const runningLists = (lockState.__linkiEnrichLists ??= new Set<string>());
const runningAccounts = (lockState.__linkiEnrichAccounts ??= new Set<string>());

/** Claims the list and account for a bulk run. Returns a release function, or null when either is busy. */
export function acquireEnrichLock(listId: string, accountId: string): (() => void) | null {
  if (runningLists.has(listId) || runningAccounts.has(accountId)) return null;
  runningLists.add(listId);
  runningAccounts.add(accountId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runningLists.delete(listId);
    runningAccounts.delete(accountId);
  };
}

export interface EnrichListResult { enriched: number; failed: number; stopped?: "budget" | "blocked" | "paused"; reason?: string }

export async function enrichList(
  ctx: BrowserContext,
  listId: string,
  delayMs = 2000,
  onProgress?: (count: number, total: number) => void,
  accountId?: string
): Promise<EnrichListResult> {
  const db = getDb();

  // Only targets with a sales_nav_url that haven't been enriched yet
  const targets = db.prepare(`
    SELECT t.id, t.sales_nav_url, t.full_name
    FROM targets t
    JOIN list_targets lt ON lt.target_id = t.id
    WHERE lt.list_id = ?
      AND t.sales_nav_url IS NOT NULL
      AND t.enriched_profile_at IS NULL
    ORDER BY t.created_at ASC
  `).all(listId) as Array<{ id: string; sales_nav_url: string; full_name: string }>;

  const total = targets.length;
  console.log(`[enrich] Starting enrichment for ${total} profiles in list ${listId}`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (accountId) {
      const paused = discoveryPausedUntil(accountId);
      if (paused) {
        console.warn(`[enrich] account ${accountId} paused until ${paused.until} (${paused.reason}) — stopping`);
        return { enriched, failed, stopped: "paused", reason: paused.reason };
      }
      // Each profile load counts against the account's daily profile_view budget.
      if (!consume(accountId, "profile_view")) {
        console.warn(`[enrich] daily profile_view budget used up for ${accountId} — stopping at ${i}/${total}`);
        return { enriched, failed, stopped: "budget" };
      }
    }
    console.log(`[enrich] ${i + 1}/${total} — ${target.full_name}`);
    const r = await enrichProfileDetailed(ctx, target);
    if (r.status === "blocked") {
      console.warn(`[enrich] ${r.reason} — stopping bulk enrichment for list ${listId}`);
      if (accountId) pauseDiscovery(accountId, r.reason);
      return { enriched, failed, stopped: "blocked", reason: r.reason };
    }
    if (r.status === "ok" || r.status === "empty") enriched++; else failed++;
    console.log(`[enrich] ${i + 1}/${total} done (${enriched} ok, ${failed} failed)`);
    onProgress?.(i + 1, total);
    if (delayMs > 0 && i < targets.length - 1) await new Promise((res) => setTimeout(res, jitter(delayMs, delayMs * 1.5)));
  }

  console.log(`[enrich] Done — ${enriched} enriched, ${failed} failed`);
  return { enriched, failed };
}
