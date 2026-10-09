import type Database from "better-sqlite3";
import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { CREDIT_COSTS, debit, ensureBilling, parseTime, seats } from "@/lib/credits/ledger";
import { leadDomain } from "@/lib/blocklist/store";
import type { Icp } from "@/lib/icp/schema";

/**
 * AI Competitor Filtering: before an agent writes to a lead, check whether the lead's company is a
 * direct competitor or functional substitute of ours. Known competitors from the ICP match for free;
 * anything else is asked once per company (cached) on the fast model. A user can allow a company,
 * which wins over the verdict from then on. Costs CREDIT_COSTS.competitor_filter_per_seat per member
 * per month, prorated when switched on mid-cycle and renewed with the monthly refill.
 */

type DB = Database.Database;
export const FILTER_SETTING = (ws: string) => `competitor_filter:${ws}`;

export function filterEnabled(db: DB, ws: string): boolean {
  return (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(FILTER_SETTING(ws)) as { value: string } | undefined)?.value === "1";
}

function setEnabled(db: DB, ws: string, on: boolean) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(FILTER_SETTING(ws), on ? "1" : "0");
}

/** What switching on costs now: the monthly price for the days left in this cycle, rounded up. */
export function prorated(db: DB, ws: string, now = new Date()): { now: number; monthly: number; days_left: number; renews_at: string } {
  const b = ensureBilling(db, ws, now);
  const monthly = CREDIT_COSTS.competitor_filter_per_seat * seats(db, ws);
  const start = parseTime(b.cycle_start).getTime(); const end = parseTime(b.next_refill_at).getTime();
  const left = Math.max(0, end - now.getTime());
  return { now: Math.max(1, Math.ceil(monthly * left / Math.max(1, end - start))), monthly, days_left: Math.ceil(left / 86_400_000), renews_at: b.next_refill_at };
}

/** Switch on (charges the prorated price; throws InsufficientCreditsError) or off (free, no refund). */
export function setCompetitorFilter(db: DB, ws: string, on: boolean, userId: string | null): number {
  if (!on) { setEnabled(db, ws, false); return 0; }
  if (filterEnabled(db, ws)) return 0;
  const p = prorated(db, ws);
  debit(db, ws, { type: "competitor_filter", credits: p.now, userId, units: seats(db, ws), note: `${p.days_left} days` });
  setEnabled(db, ws, true);
  return p.now;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const companyKey = (domain: string | null, name: string | null) => domain || (norm(name) ? `name:${norm(name)}` : null);

const verdict = z.object({ is_competitor: z.boolean(), reason: z.string().max(300) });

export interface LeadCompany { id: string; company: string | null }

/**
 * Why this lead's company is filtered as a competitor, or null. Only runs while the filter is on.
 * AI failures are not verdicts: the lead passes (and is checked again next time).
 */
export async function competitorReason(db: DB, ws: string, icp: Icp | null, lead: LeadCompany): Promise<string | null> {
  if (!filterEnabled(db, ws)) return null;
  const info = db.prepare(`SELECT c.name, c.industry, c.description FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`).get(lead.id) as
    { name: string | null; industry: string | null; description: string | null } | undefined;
  const domain = leadDomain(db, lead.id);
  const name = info?.name || lead.company;
  const key = companyKey(domain, name);
  if (!key) return null;
  const cached = db.prepare("SELECT is_competitor, allowed, reason FROM competitor_checks WHERE workspace_id = ? AND company_key = ?").get(ws, key) as
    { is_competitor: number; allowed: number; reason: string | null } | undefined;
  if (cached) return cached.is_competitor && !cached.allowed ? cached.reason || "Competitor" : null;
  if (icp && norm(name) && norm(name) === norm(icp.company_name)) return null; // our own company isn't a competitor

  let result: z.infer<typeof verdict> | null = null;
  const known = (icp?.competitors ?? []).find((c) => (norm(c.name) && norm(c.name) === norm(name)) || (domain && c.website && c.website.toLowerCase().includes(domain)));
  if (known) result = { is_competitor: true, reason: `Listed as a competitor (${known.name})` };
  else if (icp) {
    try {
      result = await aiJson({
        workspaceId: ws, purpose: "competitor_check",
        instructions: [
          "Decide whether the prospect company competes with our company: it sells a product or service that a buyer would choose instead of ours (a direct competitor or a functional substitute).",
          "Companies that would buy or use our product, partners, agencies serving other markets, and companies in unrelated markets are NOT competitors.",
          "If you are unsure, answer false. Give a short reason a user can read.",
        ],
        data: {
          our_company: { name: icp.company_name, industry: icp.company_industry, offer: icp.offer, value_props: icp.value_props, known_competitors: icp.competitors.map((c) => c.name) },
          prospect_company: { name, domain, industry: info?.industry ?? null, description: info?.description?.slice(0, 1500) ?? null },
        },
        outputShape: `{"is_competitor":false,"reason":"one short sentence"}`,
        schema: verdict, temperature: 0,
      });
    } catch (err) {
      console.warn("[competitors] check failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
  if (!result) return null;
  db.prepare(`INSERT INTO competitor_checks (workspace_id, company_key, company_name, domain, is_competitor, reason) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, company_key) DO UPDATE SET is_competitor = excluded.is_competitor, reason = excluded.reason, checked_at = datetime('now')`)
    .run(ws, key, name, domain, result.is_competitor ? 1 : 0, result.reason.slice(0, 300));
  return result.is_competitor ? result.reason || "Competitor" : null;
}

export interface FilteredRow { company_key: string; company_name: string | null; domain: string | null; reason: string | null; checked_at: string; leads: number }

/** Companies filtered as competitors in the last 30 days (not yet allowed). */
export function filteredCompanies(db: DB, ws: string, q = ""): FilteredRow[] {
  const like = `%${q.trim().toLowerCase()}%`;
  return db.prepare(`SELECT cc.company_key, cc.company_name, cc.domain, cc.reason, cc.checked_at,
      (SELECT COUNT(*) FROM targets t WHERE t.workspace_id = cc.workspace_id AND t.skip_reason LIKE 'Competitor:%' AND lower(COALESCE(t.company, '')) = lower(COALESCE(cc.company_name, ''))) AS leads
    FROM competitor_checks cc WHERE cc.workspace_id = ? AND cc.is_competitor = 1 AND cc.allowed = 0 AND cc.checked_at > datetime('now', '-30 days')
      AND (lower(COALESCE(cc.company_name, '')) LIKE ? OR lower(COALESCE(cc.domain, '')) LIKE ?)
    ORDER BY cc.checked_at DESC LIMIT 500`).all(ws, like, like) as FilteredRow[];
}

/** "Not a competitor": allow this company from now on. Leads skipped for it go back to qualified. */
export function allowCompany(db: DB, ws: string, key: string): boolean {
  const row = db.prepare("SELECT company_name FROM competitor_checks WHERE workspace_id = ? AND company_key = ?").get(ws, key) as { company_name: string | null } | undefined;
  if (!row) return false;
  db.transaction(() => {
    db.prepare("UPDATE competitor_checks SET allowed = 1 WHERE workspace_id = ? AND company_key = ?").run(ws, key);
    if (row.company_name) db.prepare(`UPDATE targets SET agent_status = 'qualified', skip_reason = NULL, agent_status_at = datetime('now')
      WHERE workspace_id = ? AND agent_status = 'skipped' AND skip_reason LIKE 'Competitor:%' AND lower(COALESCE(company, '')) = lower(?)`).run(ws, row.company_name);
  })();
  return true;
}
