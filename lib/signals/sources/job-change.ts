import { scrapeProfile } from "@/lib/linkedin/profile-scrape";
import { consume } from "@/lib/linkedin/budget";
import type { SourceRunner } from "@/lib/signals/sources/types";

/** How many contacts to re-check per run: each costs a full profile load. */
const PER_RUN = 5;
const RECHECK_DAYS = 30;

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Same employer? Tolerates "Acme" vs "Acme Inc." and similar suffix noise. */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a).replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|sa|bv|plc)\b/g, "").trim();
  const y = norm(b).replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|sa|bv|plc)\b/g, "").trim();
  if (!x || !y) return true; // unknown → do not claim a change
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Re-reads profiles of contacts in the agent's list (oldest check first) and emits a
 * job_change signal when their current employer differs from what we stored.
 */
export const jobChangeRunner: SourceRunner = async (ctx) => {
  if (!ctx.browser || !ctx.agent.linkedin_account_id) throw new Error("Job-change tracking needs an authenticated LinkedIn account on the agent");
  const rows = ctx.db.prepare(`SELECT t.id, t.company, t.title, t.sales_nav_url, t.linkedin_url, t.full_name FROM targets t
      JOIN list_targets lt ON lt.target_id = t.id
     WHERE lt.list_id = ? AND t.sales_nav_url IS NOT NULL
       AND (t.posts_scraped_at IS NULL OR t.posts_scraped_at < datetime('now', ?))
     ORDER BY t.posts_scraped_at IS NOT NULL, t.posts_scraped_at LIMIT ?`)
    .all(ctx.agent.list_id, `-${RECHECK_DAYS} days`, PER_RUN) as Array<{ id: string; company: string | null; title: string | null; sales_nav_url: string; linkedin_url: string | null; full_name: string | null }>;

  for (const t of rows) {
    if (!consume(ctx.agent.linkedin_account_id, "profile_view")) break;
    const profile = await scrapeProfile(ctx.browser, t);
    ctx.db.prepare("UPDATE targets SET posts_scraped_at = datetime('now'), headline = COALESCE(?, headline), summary = COALESCE(?, summary) WHERE id = ?")
      .run(profile.headline, profile.summary, t.id);
    const current = profile.positions.find((p) => p.current);
    if (!current?.company || sameCompany(current.company, t.company)) continue;
    const started = current.started?.year ? `${current.started.year}-${String(current.started.month ?? 1).padStart(2, "0")}-01` : null;
    ctx.db.prepare("UPDATE targets SET company = ?, title = COALESCE(?, title) WHERE id = ?").run(current.company, current.title || null, t.id);
    ctx.emitForTarget(t.id, {
      type: "job_change",
      title: `Started as ${current.title || "a new role"} at ${current.company}`,
      snippet: t.company ? `Previously at ${t.company}` : null,
      sourceUrl: profile.linkedin_url ?? t.linkedin_url,
      dedupeKey: `job_change:${t.id}:${norm(current.company)}`,
      occurredAt: started,
      metadata: { from_company: t.company, to_company: current.company, new_title: current.title },
    });
  }
};
