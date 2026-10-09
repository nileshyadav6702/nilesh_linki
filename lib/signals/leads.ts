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
  profileImageUrl?: string | null;
  /** About text when the source has it (saves a profile read before scoring). */
  summary?: string | null;
  /** Firmographics when the source has them (people databases): stored on the company record. */
  companyInfo?: { name: string; website?: string | null; industry?: string | null; employeeCount?: number | null; description?: string | null; linkedinUrl?: string | null; location?: string | null } | null;
}

export function normalizeProfileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/in/${profileSlug(decodeURIComponent(m[1]))}` : null;
}

/**
 * Public handles ("jane-doe") are case-insensitive and stored lowercase; LinkedIn's internal
 * member ids ("ACoAAB…") are case-sensitive, so lowercasing one produces a profile that doesn't exist.
 */
export function profileSlug(slug: string): string {
  return /^ACo[A-Za-z0-9_-]{20,}$/.test(slug) ? slug : slug.toLowerCase();
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

export interface PrefilterContext {
  icp: Icp | null; ownCompany?: string | null;
  /** Require the headline to match a persona role (social signals: anyone can like a post). */
  personaGate?: boolean;
  /** Companies whose own staff aren't leads here (the competitor whose posts are being read). */
  excludeEmployeesOf?: string[];
}

/** Words in job titles that say nothing about the function on their own. */
const GENERIC_TITLE_WORDS = new Set(["of", "and", "the", "a", "an", "for", "to", "in", "at", "&", "head", "manager", "lead", "leader", "representative", "executive",
  "specialist", "senior", "junior", "sr", "jr", "director", "vp", "vice", "president", "chief", "officer", "associate", "assistant", "global", "regional",
  "business", "development", "product", "team", "principal", "staff", "consultant"]);
const FOUNDER_WORDS = ["founder", "co-founder", "cofounder", "ceo", "owner", "managing director", "chief executive", "entrepreneur"];

const wordRe = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");

/** Terms that show someone holds one of the ICP's persona roles. */
export function personaTerms(icp: Icp): { phrases: string[]; words: string[] } {
  const titles = icp.personas.flatMap((p) => p.titles).map((t) => t.toLowerCase().trim()).filter(Boolean);
  const words = new Set<string>();
  for (const t of titles) for (const w of t.split(/[^a-z0-9+-]+/)) if (w.length >= 3 && !GENERIC_TITLE_WORDS.has(w)) words.add(w);
  if (titles.some((t) => /development representative|sdr|bdr/.test(t))) ["sdr", "bdr", "business development"].forEach((w) => words.add(w));
  if (titles.some((t) => /account executive/.test(t))) ["account executive", "account manager", "ae"].forEach((w) => words.add(w));
  if (titles.some((t) => /chief revenue/.test(t))) words.add("cro");
  if (titles.some((t) => FOUNDER_WORDS.some((f) => t.includes(f)))) FOUNDER_WORDS.forEach((w) => words.add(w));
  return { phrases: titles, words: [...words] };
}

/** True when the headline/title names a persona role (or there is nothing to judge from). */
export function matchesPersona(text: string, icp: Icp): boolean {
  const { phrases, words } = personaTerms(icp);
  if (!phrases.length || !text.trim()) return true;
  const t = text.toLowerCase();
  return phrases.some((p) => t.includes(p)) || words.some((w) => wordRe(w).test(t));
}

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
  for (const name of ctx.excludeEmployeesOf ?? []) {
    if (name && worksAt(name)) return { ok: false, reason: `Works at ${name}` };
  }
  if (ctx.personaGate && ctx.icp && !matchesPersona(`${c.headline ?? ""} ${c.title ?? ""}`, ctx.icp)) {
    return { ok: false, reason: "Headline matches no target persona" };
  }
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
  if (!existing && url) existing = db.prepare("SELECT id, agent_id FROM targets WHERE workspace_id = ? AND lower(rtrim(linkedin_url, '/')) = lower(?)").get(workspaceId, url) as typeof existing;

  const parsed = splitHeadline(c.headline);
  if (existing) {
    db.prepare(`UPDATE targets SET
        headline = COALESCE(headline, ?), title = COALESCE(title, ?), company = COALESCE(company, ?),
        linkedin_member_urn = COALESCE(linkedin_member_urn, ?), linkedin_url = COALESCE(linkedin_url, ?),
        profile_image_url = COALESCE(?, profile_image_url),
        agent_id = COALESCE(agent_id, ?), agent_status = COALESCE(agent_status, CASE WHEN ? IS NOT NULL THEN 'new' END)
      WHERE id = ?`).run(c.headline ?? null, c.title ?? parsed.title, c.company ?? parsed.company, urn, url, c.profileImageUrl ?? null, agentId, agentId, existing.id);
    return { targetId: existing.id, created: false };
  }

  const id = randomUUID();
  const first = c.firstName ?? c.name.split(/\s+/)[0] ?? null;
  const last = c.lastName ?? (c.name.split(/\s+/).slice(1).join(" ") || null);
  db.prepare(`INSERT INTO targets (id, workspace_id, linkedin_url, sales_nav_url, first_name, last_name, full_name, title, company, location,
      headline, linkedin_member_urn, lead_source, agent_id, agent_status, agent_status_at, profile_image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
    .run(id, workspaceId, url, c.salesNavUrl ?? null, first, last, c.name, c.title ?? parsed.title, c.company ?? parsed.company, c.location ?? null,
      c.headline ?? null, urn, source, agentId, agentId ? "new" : null, c.profileImageUrl ?? null);
  return { targetId: id, created: true };
}
