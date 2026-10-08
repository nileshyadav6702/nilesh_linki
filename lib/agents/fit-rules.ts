import type { Icp } from "@/lib/icp/schema";
import { exclusionTerms, excludesServiceProviders, hasTerm } from "@/lib/icp/targeting";

/** The lead fields rule-based screening reads. */
export interface ScreenLead {
  headline: string | null; title: string | null; company: string | null; summary: string | null;
  company_industry?: string | null; company_description?: string | null;
}

export type ScreenResult = { ok: true } | { ok: false; reason: string };

const SERVICE_ROLE = /\b(agency|agencies|consultant|consultants|consulting|consultancy|freelance|freelancer|freelancing|self[- ]employed|outsourcing)\b/i;
const SERVICE_COMPANY = /\b(services|agency|consulting|consultancy|outsourcing)\b/i;

/** Agencies, consultants, freelancers and B2B service companies, from the headline, title and company. */
export function looksLikeServiceProvider(l: ScreenLead): boolean {
  if (SERVICE_ROLE.test(`${l.headline ?? ""} ${l.title ?? ""} ${l.company ?? ""}`)) return true;
  return SERVICE_COMPANY.test(`${l.company ?? ""} ${l.company_industry ?? ""}`);
}

/** Excluded company or keyword the lead's company, headline or title mentions, if any. */
export function excludedTerm(l: ScreenLead, terms: string[]): string | null {
  const company = (l.company ?? "").toLowerCase();
  const text = `${l.headline ?? ""} ${l.title ?? ""} ${l.company ?? ""}`;
  return terms.find((t) => (t.length >= 3 && company.includes(t.toLowerCase())) || hasTerm(text, t)) ?? null;
}

/** True when the lead's headline, title, about or company text contains at least one keyword. */
export function hasMandatoryKeyword(l: ScreenLead, keywords: string[]): boolean {
  const text = [l.headline, l.title, l.summary, l.company, l.company_industry, l.company_description].filter(Boolean).join(" \n ");
  return keywords.some((k) => hasTerm(text, k));
}

/**
 * Cheap checks run before any LLM call. Exclusion hits are positive evidence, so they apply to
 * every lead; the mandatory-keyword check only applies when `checkKeywords` (the caller skips it
 * for leads with no profile text yet, which are parked rather than disqualified).
 */
export function screenLead(l: ScreenLead, icp: Icp, checkKeywords = true): ScreenResult {
  const term = excludedTerm(l, exclusionTerms(icp));
  if (term) return { ok: false, reason: `Excluded: matches "${term}"` };
  if (excludesServiceProviders(icp) && looksLikeServiceProvider(l)) return { ok: false, reason: "Excluded: looks like a service provider, agency, consultant or freelancer" };
  const keywords = icp.mandatory_keywords.filter((k) => k.trim());
  if (checkKeywords && keywords.length && !hasMandatoryKeyword(l, keywords)) {
    return { ok: false, reason: `Missing mandatory keywords (needs one of: ${keywords.slice(0, 5).join(", ")})` };
  }
  return { ok: true };
}
