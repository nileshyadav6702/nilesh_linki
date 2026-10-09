import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { format } from "date-fns";
import { TregError, tregCall } from "@/lib/treg/client";
import type { TregCompany } from "@/lib/treg/linkedin";
import { ingestSignal } from "@/lib/platform/signals";

/**
 * Company context for a lead: the company page (logo, industry, size, founded, specialties)
 * and its latest funding round, each read once per company and shared by every lead there.
 * A round in the last year becomes a "Raised funding" signal on the lead, which warms it up.
 */

type DB = Database.Database;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** A funding round counts as a buying signal for this long. */
export const FUNDING_SIGNAL_DAYS = 365;

export interface FundingRound { id: string; announcedOn: string; stage: string | null; name: string | null; amountUsd: number | null }

export const domainOf = (website: string | null | undefined): string | null => {
  if (!website) return null;
  try { return new URL(/^https?:\/\//.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

/** Store (or merge into) the workspace's company row; returns its id. Existing values win. */
export function saveCompany(db: DB, workspaceId: string, c: TregCompany): string {
  const domain = domainOf(c.website);
  const existing = db.prepare("SELECT id FROM companies WHERE workspace_id = ? AND ((? IS NOT NULL AND linkedin_url = ?) OR lower(name) = lower(?) OR (? IS NOT NULL AND domain = ?))")
    .get(workspaceId, c.linkedin_url, c.linkedin_url, c.name, domain, domain) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) db.prepare("INSERT INTO companies (id, workspace_id, name) VALUES (?, ?, ?)").run(id, workspaceId, c.name);
  const employees = Number((c.employees ?? "").replace(/[^\d]/g, "")) || null;
  db.prepare(`UPDATE companies SET description = COALESCE(description, ?), website = COALESCE(website, ?), domain = COALESCE(domain, ?),
      employee_count = COALESCE(employee_count, ?), employee_range = COALESCE(employee_range, ?), location = COALESCE(location, ?),
      industry = COALESCE(industry, ?), linkedin_url = COALESCE(linkedin_url, ?), logo_url = COALESCE(logo_url, ?), founded_year = COALESCE(founded_year, ?),
      specialties = COALESCE(specialties, ?), org_type = COALESCE(org_type, ?), profile_fetched_at = datetime('now') WHERE id = ?`)
    .run(c.description?.slice(0, 2000) ?? null, c.website, domain, employees, c.size_range ?? c.employees, c.location, c.industry, c.linkedin_url,
      c.logo ?? null, c.founded ?? null, c.specialties ?? null, c.org_type ?? null, id);
  return id;
}

/** Latest funding round for a company website (aviato, $0.01 when it finds rounds). */
export async function tregLatestFunding(workspaceId: string, domain: string): Promise<FundingRound | null> {
  let r;
  try {
    r = await tregCall<Obj>("aviato.companies.funding_rounds", {
      workspaceId, purpose: "funding", method: "GET", query: { website: domain, perPage: 5, page: 0 }, maxCostUsd: 0.02,
    });
  } catch (err) {
    if (err instanceof TregError && err.status === 404) return null; // company not in the funding database
    throw err;
  }
  const body = isObj(r.data) && isObj(r.data.output) ? r.data.output : r.data;
  // Mergers, acquisitions and IPOs aren't money raised to spend.
  const rounds = (isObj(body) && Array.isArray(body.fundingRounds) ? body.fundingRounds : []).filter(isObj)
    .filter((x) => !(typeof x.stage === "string" && /merger|acqui|ipo|buyout/i.test(x.stage)));
  const latest = rounds
    .filter((x) => typeof x.announcedOn === "string" && Number.isFinite(Date.parse(x.announcedOn as string)))
    .sort((a, b) => Date.parse(b.announcedOn as string) - Date.parse(a.announcedOn as string))[0];
  if (!latest) return null;
  return {
    id: String(latest.id ?? latest.announcedOn), announcedOn: new Date(Date.parse(latest.announcedOn as string)).toISOString(),
    stage: typeof latest.stage === "string" ? latest.stage : null, name: typeof latest.name === "string" ? latest.name : null,
    amountUsd: typeof latest.moneyRaised === "number" ? latest.moneyRaised : null,
  };
}

/** "$2.9M", "$450K". */
export function money(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
}

/** Look the company's funding up once (cached on the row), then put a recent round on the lead. */
export async function applyFunding(db: DB, workspaceId: string, companyId: string, targetId: string, now = Date.now()): Promise<boolean> {
  const co = db.prepare("SELECT domain, website, funding_checked_at, last_funding_json FROM companies WHERE id = ?").get(companyId) as
    { domain: string | null; website: string | null; funding_checked_at: string | null; last_funding_json: string | null } | undefined;
  if (!co) return false;
  let round: FundingRound | null = null;
  if (co.funding_checked_at) {
    try { round = co.last_funding_json ? JSON.parse(co.last_funding_json) as FundingRound : null; } catch { round = null; }
  } else {
    const domain = co.domain ?? domainOf(co.website);
    if (!domain) return false;
    round = await tregLatestFunding(workspaceId, domain);
    db.prepare("UPDATE companies SET funding_checked_at = datetime('now'), last_funding_json = ? WHERE id = ?").run(round ? JSON.stringify(round) : null, companyId);
  }
  if (!round || now - Date.parse(round.announcedOn) > FUNDING_SIGNAL_DAYS * 86_400_000) return false;
  const amount = money(round.amountUsd);
  ingestSignal({
    workspaceId, targetId, companyId, type: "funding", title: `Raised funding · ${format(new Date(round.announcedOn), "MMMM yyyy")}`,
    snippet: [round.stage, amount].filter(Boolean).join(" · ") || undefined, occurredAt: round.announcedOn, source: "treg:funding",
    metadata: { stage: round.stage, amount_usd: round.amountUsd, round: round.name }, dedupeKey: `funding:${companyId}:${round.id}:${targetId}`,
  });
  return true;
}
