import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Icp } from "@/lib/icp/schema";

export interface LeadCandidate {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  profileUrl?: string | null;
  memberUrn?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  salesNavUrl?: string | null;
}

export function normalizeProfileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

/** "VP Sales at Acme | ex-Google" → { title: "VP Sales", company: "Acme" } */
export function splitHeadline(headline: string | null | undefined): { title: string | null; company: string | null } {
  if (!headline) return { title: null, company: null };
  const first = headline.split(/\s[|•·]\s/)[0].trim();
  const m = first.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (m) return { title: m[1].trim().slice(0, 200) || null, company: m[2].trim().slice(0, 200) || null };
  return { title: first.slice(0, 200) || null, company: null };
}

const DEFAULT_EXCLUSIONS = ["recruiter", "talent acquisition", "student", "intern", "looking for new opportunities", "open to work", "job seeker"];

export interface PrefilterContext { icp: Icp | null; ownCompany?: string | null }

/**
 * Cheap rule-based screen run before any enrichment or LLM spend. Drops people who
 * are obviously not buyers: excluded titles, competitors' and our own employees.
 */
export function prefilterLead(c: LeadCandidate, ctx: PrefilterContext): { ok: true } | { ok: false; reason: string } {
  const headline = `${c.headline ?? ""} ${c.title ?? ""} ${c.company ?? ""}`.toLowerCase();
  const personaTitles = (ctx.icp?.personas ?? []).flatMap((p) => p.titles).map((t) => t.toLowerCase());
  const exclusions = [...DEFAULT_EXCLUSIONS.filter((x) => !personaTitles.some((t) => t.includes(x))), ...(ctx.icp?.exclusions ?? []).map((x) => x.toLowerCase())];
  for (const term of exclusions) {
    if (term && headline.includes(term)) return { ok: false, reason: `Excluded term: ${term}` };
  }
  const worksAt = (name: string) => {
    const n = name.toLowerCase().trim();
    if (n.length < 3) return false;
    const company = (c.company ?? splitHeadline(c.headline).company ?? "").toLowerCase();
    return company.includes(n) || headline.includes(` at ${n}`) || headline.includes(`@${n}`) || headline.includes(`@ ${n}`);
  };
  for (const comp of ctx.icp?.competitors ?? []) {
    if (comp.name && worksAt(comp.name)) return { ok: false, reason: `Works at competitor ${comp.name}` };
  }
  const own = ctx.ownCompany || ctx.icp?.company_name;
  if (own && worksAt(own)) return { ok: false, reason: "Works at your company" };
  return { ok: true };
}

/**
 * Find-or-create the contact for a discovered person, scoped to the workspace. Identity is
 * the LinkedIn member URN first, then the normalized /in/ URL — so repeat signals stack on
 * one contact instead of creating duplicates.
 */
export function upsertLead(db: Database.Database, workspaceId: string, agentId: string | null, c: LeadCandidate, source = "signal"): { targetId: string; created: boolean } {
  const url = normalizeProfileUrl(c.profileUrl);
  const urn = c.memberUrn ?? null;
  let existing: { id: string; agent_id: string | null } | undefined;
  if (urn) existing = db.prepare("SELECT id, agent_id FROM targets WHERE workspace_id = ? AND linkedin_member_urn = ?").get(workspaceId, urn) as typeof existing;
  if (!existing && url) existing = db.prepare("SELECT id, agent_id FROM targets WHERE workspace_id = ? AND lower(rtrim(linkedin_url, '/')) = ?").get(workspaceId, url) as typeof existing;

  const parsed = splitHeadline(c.headline);
  if (existing) {
    db.prepare(`UPDATE targets SET
        headline = COALESCE(headline, ?), title = COALESCE(title, ?), company = COALESCE(company, ?),
        linkedin_member_urn = COALESCE(linkedin_member_urn, ?), linkedin_url = COALESCE(linkedin_url, ?),
        agent_id = COALESCE(agent_id, ?), agent_status = COALESCE(agent_status, CASE WHEN ? IS NOT NULL THEN 'new' END)
      WHERE id = ?`).run(c.headline ?? null, c.title ?? parsed.title, c.company ?? parsed.company, urn, url, agentId, agentId, existing.id);
    return { targetId: existing.id, created: false };
  }

  const id = randomUUID();
  const first = c.firstName ?? c.name.split(/\s+/)[0] ?? null;
  const last = c.lastName ?? (c.name.split(/\s+/).slice(1).join(" ") || null);
  db.prepare(`INSERT INTO targets (id, workspace_id, linkedin_url, sales_nav_url, first_name, last_name, full_name, title, company, location,
      headline, linkedin_member_urn, lead_source, agent_id, agent_status, agent_status_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(id, workspaceId, url, c.salesNavUrl ?? null, first, last, c.name, c.title ?? parsed.title, c.company ?? parsed.company, c.location ?? null,
      c.headline ?? null, urn, source, agentId, agentId ? "new" : null);
  return { targetId: id, created: true };
}
