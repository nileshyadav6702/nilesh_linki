import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { TregError, tregEnabled } from "@/lib/treg/client";
import { tregProfile } from "@/lib/treg/linkedin";
import { NEEDS_DATA_MAX_ATTEMPTS, NEEDS_DATA_RETRY_HOURS } from "@/lib/linkedin/needs-data";

/**
 * Headline / about for leads parked as needs_data (lib/agents/fit.ts can't judge them against
 * the ICP without), read through treg instead of the LinkedIn session's 25-a-day profile views.
 * Same attempt bookkeeping as lib/linkedin/needs-data.ts; once filled, fit.ts re-scores them.
 */

export const TREG_ENRICH_PER_PASS = 40;
const CONCURRENCY = 5;

type DB = Database.Database;
interface Candidate { id: string; workspace_id: string; linkedin_url: string }

export function tregEnrichCandidates(db: DB, limit: number, workspaceId?: string): Candidate[] {
  return db.prepare(`SELECT t.id, t.workspace_id, t.linkedin_url FROM targets t
    WHERE t.agent_status = 'needs_data' AND t.linkedin_url LIKE '%linkedin.com/in/%' AND t.enriched_profile_at IS NULL
      AND TRIM(COALESCE(t.headline, '')) = '' AND TRIM(COALESCE(t.summary, '')) = ''
      AND t.profile_enrich_attempts < ? AND (t.profile_enrich_attempted_at IS NULL OR t.profile_enrich_attempted_at < datetime('now', ?))
      AND (? IS NULL OR t.workspace_id = ?)
    ORDER BY t.intent_score DESC, t.profile_enrich_attempts, t.created_at LIMIT ?`)
    .all(NEEDS_DATA_MAX_ATTEMPTS, `-${NEEDS_DATA_RETRY_HOURS} hours`, workspaceId ?? null, workspaceId ?? null, limit) as Candidate[];
}

export interface TregEnrichResult { attempted: number; filled: number; stopped?: string }

/** One bounded pass. Stops early when treg is out of balance, the key is rejected or the day's budget is spent. */
export async function enrichNeedsDataViaTreg(db: DB = getDb(), limit = TREG_ENRICH_PER_PASS, workspaceId?: string): Promise<TregEnrichResult> {
  const result: TregEnrichResult = { attempted: 0, filled: 0 };
  if (!tregEnabled()) return result;
  const queue = tregEnrichCandidates(db, limit, workspaceId);
  const blockedWorkspaces = new Set<string>();
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (result.stopped || blockedWorkspaces.has(c.workspace_id)) continue;
      db.prepare("UPDATE targets SET profile_enrich_attempts = profile_enrich_attempts + 1, profile_enrich_attempted_at = datetime('now') WHERE id = ?").run(c.id);
      result.attempted++;
      try {
        const p = await tregProfile(c.workspace_id, c.linkedin_url);
        if (!p) continue;
        const filled = !!(p.headline || p.about);
        db.prepare(`UPDATE targets SET headline = COALESCE(?, headline), summary = COALESCE(?, summary), location = COALESCE(location, ?),
            first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), full_name = COALESCE(full_name, ?),
            company = COALESCE(company, ?), title = COALESCE(title, ?),
            enriched_profile_at = CASE WHEN ? THEN datetime('now') ELSE enriched_profile_at END
          WHERE id = ?`)
          .run(p.headline, p.about, p.location, p.first_name, p.last_name, p.full_name, p.current?.company ?? null, p.current?.title ?? null, filled ? 1 : 0, c.id);
        if (filled) result.filled++;
      } catch (err) {
        if (err instanceof TregError && err.code === "cap") { blockedWorkspaces.add(c.workspace_id); continue; }
        if (err instanceof TregError && err.blocking) { result.stopped = err.message; continue; }
        console.warn(`[treg-enrich] ${c.id}:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (result.attempted) console.log(`[treg-enrich] filled ${result.filled}/${result.attempted} profile(s)${result.stopped ? ` (stopped: ${result.stopped})` : ""}`);
  return result;
}
