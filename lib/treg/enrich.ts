import type Database from "better-sqlite3";
import { withCostTag } from "@/lib/treg/cost-context";
import { getDb } from "@/lib/db";
import { TregError, tregEnabled } from "@/lib/treg/client";
import { tregCompany, tregProfile } from "@/lib/treg/linkedin";
import { applyFunding, saveCompany } from "@/lib/treg/company";
import { tregFetchPages } from "@/lib/treg/web";
import { NEEDS_DATA_MAX_ATTEMPTS, NEEDS_DATA_RETRY_HOURS } from "@/lib/linkedin/needs-data";

/**
 * Headline / about for leads parked as needs_data (lib/agents/fit.ts can't judge them against
 * the ICP without), read through treg instead of the LinkedIn session's 25-a-day profile views.
 * Same attempt bookkeeping as lib/linkedin/needs-data.ts; once filled, fit.ts re-scores them.
 */

export const TREG_ENRICH_PER_PASS = 40;
const CONCURRENCY = 5;

/**
 * Before scoring: every lead that passed the free persona gate gets its profile (headline,
 * about, photo, current job) and its company (page firmographics and latest funding round)
 * read first, so the model judges the company instead of saying "company unknown", and a
 * recent round shows up as a signal. Profile ~$0.0012 once per lead (enriched_profile_at);
 * company page $0.001 once per company, shared by every lead there; funding $0.01 once per
 * company, only when `funding` (the agent tracks "Companies that have recently raised funds").
 */
export async function enrichForScoring(db: DB, workspaceId: string, targetIds: string[], opts: { funding?: boolean } = {}): Promise<number> {
  const withFunding = opts.funding ?? true;
  if (!tregEnabled() || !targetIds.length) return 0;
  const rows = db.prepare(`SELECT t.id, t.linkedin_url, t.enriched_profile_at, t.company_id, c.linkedin_url company_url, c.profile_fetched_at, c.funding_checked_at
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id IN (${targetIds.map(() => "?").join(",")})`).all(...targetIds) as Array<{
      id: string; linkedin_url: string | null; enriched_profile_at: string | null; company_id: string | null; company_url: string | null; profile_fetched_at: string | null; funding_checked_at: string | null;
    }>;
  const pages = new Map<string, Promise<string | null>>(); // one company-page read per company per pass
  const companyId = (url: string) => {
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (!pages.has(key)) pages.set(key, tregCompany(workspaceId, url).then((c) => (c ? saveCompany(db, workspaceId, c) : null)));
    return pages.get(key)!;
  };
  const funding = new Map<string, Promise<boolean>>();
  let done = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        let coUrl = r.profile_fetched_at ? null : r.company_url;
        if (!r.enriched_profile_at && r.linkedin_url?.includes("linkedin.com/in/")) {
          const p = await tregProfile(workspaceId, r.linkedin_url);
          db.prepare(`UPDATE targets SET headline = COALESCE(headline, ?), summary = COALESCE(summary, ?), location = COALESCE(location, ?), profile_image_url = COALESCE(profile_image_url, ?),
              company = COALESCE(company, ?), title = COALESCE(title, ?), enriched_profile_at = datetime('now') WHERE id = ?`)
            .run(p?.headline ?? null, p?.about ?? null, p?.location ?? null, p?.avatar_url ?? null, p?.current?.company ?? null, p?.current?.title ?? null, r.id);
          if (p?.current?.companyUrl && !r.profile_fetched_at) coUrl = p.current.companyUrl;
        }
        let cid = r.company_id;
        if (coUrl && /linkedin\.com\/(company|school|showcase)\//i.test(coUrl)) {
          const id = await companyId(coUrl);
          if (id) { db.prepare("UPDATE targets SET company_id = COALESCE(company_id, ?) WHERE id = ?").run(id, r.id); cid = cid ?? id; }
        }
        if (cid && withFunding) {
          // One at a time per company: the first lookup caches the round for the leads after it.
          const target = r.id;
          const next = (funding.get(cid) ?? Promise.resolve(false)).catch(() => false).then(() => applyFunding(db, workspaceId, cid!, target));
          funding.set(cid, next);
          await next;
        }
        done++;
      } catch (err) {
        if (err instanceof TregError && err.blocking) { queue.length = 0; break; }
        console.warn(`[treg-enrich] pre-score ${r.id}:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await addWebsiteText(db, workspaceId, targetIds).catch((err) => console.warn("[treg-enrich] website text:", err instanceof Error ? err.message : err));
  return done;
}

/** Homepages read per enrichment pass (TinyFish through treg is free; Crawl4AI fallback $0.00015). */
const WEBSITES_PER_PASS = 20;

/** "Title — description — first lines" of a homepage, trimmed for the scoring prompt. */
export function websiteSummary(p: { title: string | null; description: string | null; text: string }): string {
  const lines = p.text.split("\n").map((l) => l.replace(/[#*_>\[\]()!|]/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 25);
  return [p.title, p.description, ...lines].filter(Boolean).join(" — ").slice(0, 1500);
}

/** Each lead company's homepage, once per company, so scoring knows what the company actually sells. */
export async function addWebsiteText(db: DB, workspaceId: string, targetIds: string[]): Promise<number> {
  if (!targetIds.length) return 0;
  const rows = db.prepare(`SELECT DISTINCT c.id, COALESCE(c.domain, c.website) site FROM targets t JOIN companies c ON c.id = t.company_id
    WHERE t.id IN (${targetIds.map(() => "?").join(",")}) AND c.website_fetched_at IS NULL AND COALESCE(c.domain, c.website) IS NOT NULL`)
    .all(...targetIds).slice(0, WEBSITES_PER_PASS) as Array<{ id: string; site: string }>;
  const urls = new Map<string, string>();
  for (const r of rows) {
    try { urls.set(r.id, `https://${new URL(/^https?:\/\//.test(r.site) ? r.site : `https://${r.site}`).hostname}/`); } catch { /* bad site */ }
  }
  if (!urls.size) return 0;
  const pages = await tregFetchPages(workspaceId, [...new Set(urls.values())], { fallback: true });
  const save = db.prepare("UPDATE companies SET website_text = ?, website_fetched_at = datetime('now') WHERE id = ?");
  let n = 0;
  for (const [id, url] of urls) {
    const p = pages.get(url);
    save.run(p ? websiteSummary(p) || null : null, id);
    if (p) n++;
  }
  return n;
}

type DB = Database.Database;
interface Candidate { id: string; workspace_id: string; linkedin_url: string; agent_id: string | null }

export function tregEnrichCandidates(db: DB, limit: number, workspaceId?: string): Candidate[] {
  return db.prepare(`SELECT t.id, t.workspace_id, t.linkedin_url, t.agent_id FROM targets t
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
        const p = await withCostTag({ agentId: c.agent_id, sourceType: "enrichment" }, () => tregProfile(c.workspace_id, c.linkedin_url));
        if (!p) continue;
        const filled = !!(p.headline || p.about);
        db.prepare(`UPDATE targets SET headline = COALESCE(?, headline), summary = COALESCE(?, summary), location = COALESCE(location, ?),
            first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), full_name = COALESCE(full_name, ?),
            company = COALESCE(company, ?), title = COALESCE(title, ?), profile_image_url = COALESCE(profile_image_url, ?),
            enriched_profile_at = CASE WHEN ? THEN datetime('now') ELSE enriched_profile_at END
          WHERE id = ?`)
          .run(p.headline, p.about, p.location, p.first_name, p.last_name, p.full_name, p.current?.company ?? null, p.current?.title ?? null, p.avatar_url ?? null, filled ? 1 : 0, c.id);
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
