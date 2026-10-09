import { tregCall } from "@/lib/treg/client";
import { profileUrlFor } from "@/lib/treg/linkedin";
import type { Icp } from "@/lib/icp/schema";
import type { LeadCandidate } from "@/lib/signals/leads";

/**
 * ICP → people search on Icypeas' leads database through treg (icypeas.people.search,
 * $0.00038 per returned row). Rows carry profile URL, headline, current title, company and
 * location, so they pass the prefilter and can be scored without reading LinkedIn.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const uniq = (xs: string[], n: number) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, n);

/** "11-50", "201-500", "10,000+" → headcount bounds across all the ICP's sizes. */
export function headcountRange(sizes: string[]): { ">="?: number; "<="?: number } | null {
  let lo = Infinity; let hi = 0; let open = false;
  for (const s of sizes) {
    const nums = (s.replace(/,/g, "").match(/\d+/g) ?? []).map(Number);
    if (!nums.length) continue;
    lo = Math.min(lo, nums[0]);
    if (/\+/.test(s) || nums.length === 1) open = true; else hi = Math.max(hi, nums[1]);
  }
  if (!Number.isFinite(lo)) return null;
  return open ? { ">=": lo } : { ">=": lo, "<=": hi };
}

/** The Icypeas filter object for an ICP. Null when the ICP has no titles to search for. */
export function icypeasQuery(icp: Icp): Obj | null {
  const titles = uniq(icp.personas.flatMap((p) => p.titles), 40);
  if (!titles.length) return null;
  const q: Obj = { currentJobTitle: { include: titles, ...(icp.exclusions.length ? { exclude: uniq(icp.exclusions, 40) } : {}) } };
  const geos = uniq(icp.geographies, 20);
  if (geos.length) q.location = { include: geos };
  const industries = uniq(icp.industries, 20);
  if (industries.length) q["currentCompany.industry"] = { include: industries };
  const range = headcountRange(icp.company_sizes);
  if (range) q["currentCompany.headcount"] = range;
  return q;
}

export function leadFromRow(o: Obj): LeadCandidate | null {
  const company = isObj(o.currentCompany) ? (o.currentCompany as Obj) : null;
  const name = str(o.name) ?? ([str(o.firstname), str(o.lastname)].filter(Boolean).join(" ") || null);
  const url = profileUrlFor(str(o.url) ?? str(o.linkedinUrl) ?? str(o.profileUrl));
  if (!name || !url) return null;
  return {
    name, firstName: str(o.firstname), lastName: str(o.lastname), headline: str(o.headline), profileUrl: url,
    title: str(o.lastJobTitle) ?? str(o.currentJobTitle) ?? str(o.title),
    company: str(o.lastCompanyName) ?? str(o.currentCompanyName) ?? (company ? str(company.name) : null),
    location: str(o.address) ?? str(o.location),
  };
}

/** One page of matching people. Pass the returned token back for the next page. */
export async function tregPeopleSearch(workspaceId: string, icp: Icp, size: number, token?: string | null): Promise<{ leads: LeadCandidate[]; token: string | null; total: number | null }> {
  const query = icypeasQuery(icp);
  if (!query) throw new Error("Add persona job titles to the agent's targeting to search for lookalike leads");
  const pagination: Obj = { size: Math.min(200, Math.max(1, size)) };
  if (token) pagination.token = token;
  const r = await tregCall<Obj>("icypeas.people.search", { workspaceId, purpose: "people_search", body: { query, pagination }, maxCostUsd: Math.max(0.01, size * 0.0005) });
  const body = isObj(r.data) && isObj(r.data.output) ? r.data.output : r.data;
  const rows = (isObj(body) && Array.isArray(body.leads) ? body.leads : []) as Obj[];
  const next = isObj(body) && isObj(body.pagination) ? str((body.pagination as Obj).token) : null;
  return { leads: rows.map(leadFromRow).filter((l): l is LeadCandidate => !!l), token: next, total: isObj(body) && typeof body.total === "number" ? body.total : null };
}
