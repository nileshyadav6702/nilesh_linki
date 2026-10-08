import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import { acquireEnrichLock, enrichProfileDetailed, type EnrichOutcome } from "@/lib/linkedin/enrich";
import { consume, discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";

/**
 * Fill in headline/about for agent leads parked as `needs_data` (lib/agents/fit.ts cannot
 * judge a lead against the ICP without them), so they can be re-scored.
 *
 * Bounded on every axis: a few leads per account per LinkedIn-loop pass, each profile load
 * charged to the account's daily profile_view budget, skipped while the account's discovery
 * is paused, and at most NEEDS_DATA_MAX_ATTEMPTS tries per lead (persisted, so a restart
 * does not reset it) spaced NEEDS_DATA_RETRY_HOURS apart. A lead whose profile is genuinely
 * empty stays needs_data; enrich.ts also stamps enriched_profile_at after repeated empty
 * reads, which takes it out of this query for good.
 */

export const NEEDS_DATA_PER_ACCOUNT_PER_PASS = 3;
export const NEEDS_DATA_MAX_ATTEMPTS = 3;
export const NEEDS_DATA_RETRY_HOURS = 12;

type DB = Database.Database;
interface Candidate { id: string; sales_nav_url: string; full_name: string }

/** Leads one LinkedIn account may enrich: only leads of agents in the account's own workspace. */
export function needsDataCandidates(db: DB, accountId: string, limit: number): Candidate[] {
  return db.prepare(`
    SELECT t.id, t.sales_nav_url, COALESCE(t.full_name, t.id) AS full_name
      FROM targets t
      JOIN agents a ON a.id = t.agent_id AND a.workspace_id = t.workspace_id
      JOIN accounts acc ON acc.id = a.linkedin_account_id AND acc.workspace_id = a.workspace_id
     WHERE acc.id = ?
       AND t.agent_status = 'needs_data'
       AND t.sales_nav_url IS NOT NULL AND t.enriched_profile_at IS NULL
       AND TRIM(COALESCE(t.headline, '')) = '' AND TRIM(COALESCE(t.summary, '')) = ''
       AND t.profile_enrich_attempts < ?
       AND (t.profile_enrich_attempted_at IS NULL OR t.profile_enrich_attempted_at < datetime('now', ?))
     ORDER BY t.intent_score DESC, t.profile_enrich_attempts ASC, t.created_at ASC
     LIMIT ?`).all(accountId, NEEDS_DATA_MAX_ATTEMPTS, `-${NEEDS_DATA_RETRY_HOURS} hours`, limit) as Candidate[];
}

/** Authenticated LinkedIn accounts that have at least one enrichable needs_data lead. */
export function needsDataAccounts(db: DB): string[] {
  return (db.prepare(`
    SELECT DISTINCT acc.id FROM accounts acc
      JOIN agents a ON a.linkedin_account_id = acc.id AND a.workspace_id = acc.workspace_id
      JOIN targets t ON t.agent_id = a.id AND t.workspace_id = a.workspace_id
     WHERE acc.is_authenticated = 1 AND t.agent_status = 'needs_data'
       AND t.sales_nav_url IS NOT NULL AND t.enriched_profile_at IS NULL
       AND t.profile_enrich_attempts < ?`).all(NEEDS_DATA_MAX_ATTEMPTS) as Array<{ id: string }>).map((r) => r.id);
}

export interface NeedsDataDeps {
  getContext: (accountId: string) => Promise<BrowserContext>;
  enrich: (ctx: BrowserContext, target: Candidate) => Promise<EnrichOutcome>;
  delayMs: number;
}

export interface NeedsDataResult { attempted: number; filled: number }

/** Limit a pass to one account (the account worker's own) and let it stop between leads. */
export interface NeedsDataScope { accountId?: string; shouldStop?: () => boolean }

export async function enrichNeedsDataLeads(
  deps: Partial<NeedsDataDeps> = {}, perAccount = NEEDS_DATA_PER_ACCOUNT_PER_PASS, scope: NeedsDataScope = {},
): Promise<NeedsDataResult> {
  const db = getDb();
  const getContext = deps.getContext ?? (async (id: string) => (await import("@/lib/linkedin/session")).getSessionContext(id));
  const enrich = deps.enrich ?? enrichProfileDetailed;
  const delayMs = deps.delayMs ?? 3000;
  const result: NeedsDataResult = { attempted: 0, filled: 0 };

  const accounts = needsDataAccounts(db).filter((id) => !scope.accountId || id === scope.accountId);
  for (const accountId of accounts) {
    if (scope.shouldStop?.()) break;
    if (discoveryPausedUntil(accountId)) continue;
    const candidates = needsDataCandidates(db, accountId, perAccount);
    if (candidates.length === 0) continue;
    // Same per-account lock as bulk list enrichment: never two enrichers on one session.
    const release = acquireEnrichLock(`needs-data:${accountId}`, accountId);
    if (!release) continue;
    try {
      const ctx = await getContext(accountId);
      for (let i = 0; i < candidates.length; i++) {
        const lead = candidates[i];
        if (scope.shouldStop?.()) break;
        if (!consume(accountId, "profile_view")) break; // daily profile_view budget spent
        db.prepare("UPDATE targets SET profile_enrich_attempts = profile_enrich_attempts + 1, profile_enrich_attempted_at = datetime('now') WHERE id = ?").run(lead.id);
        result.attempted++;
        const outcome = await enrich(ctx, lead);
        if (outcome.status === "blocked") {
          pauseDiscovery(accountId, outcome.reason);
          console.warn(`[needs-data] ${outcome.reason} on account ${accountId} - pausing profile enrichment`);
          break;
        }
        if (outcome.status === "ok") result.filled++;
        if (delayMs > 0 && i < candidates.length - 1) await new Promise((r) => setTimeout(r, delayMs + Math.random() * delayMs));
      }
    } finally {
      release();
    }
  }
  if (result.attempted > 0) console.log(`[needs-data] enriched ${result.filled}/${result.attempted} lead profile(s) missing headline/about`);
  return result;
}
