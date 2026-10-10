import { tregCall } from "@/lib/treg/client";
import { profileUrlFor } from "@/lib/treg/linkedin";
import type { Icp } from "@/lib/icp/schema";
import type { LeadCandidate } from "@/lib/signals/leads";
import { INDUSTRY_TREE } from "@/lib/icp/data/industries";
import { excludesServiceProviders } from "@/lib/icp/targeting";

const KNOWN_INDUSTRIES = new Set(INDUSTRY_TREE.flatMap((n) => [n.label, ...(n.children ?? [])]));

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

/**
 * The leads database uses LinkedIn's industry names ("Software Development", "Technology,
 * Information and Internet"…). ICPs often hold broader labels ("Software & SaaS"): map those,
 * keep anything already in LinkedIn's taxonomy, and drop what can't be mapped (a filter that
 * matches nothing returns nobody).
 */
const INDUSTRY_ALIASES: Array<[RegExp, string[]]> = [
  [/saas|software/i, ["Software Development", "Technology, Information and Internet", "IT Services and IT Consulting"]],
  [/^tech|information technology|\bit\b/i, ["Technology, Information and Internet", "IT Services and IT Consulting", "Software Development"]],
  [/marketing|advertising/i, ["Marketing Services", "Advertising Services"]],
  [/consult/i, ["Business Consulting and Services", "Strategic Management Services"]],
  [/fintech|financ|bank/i, ["Financial Services", "Banking"]],
  [/health|medical/i, ["Hospitals and Health Care", "Medical Equipment Manufacturing"]],
  [/e-?commerce|retail/i, ["Retail", "Online and Mail Order Retail"]],
  [/staffing|recruit/i, ["Staffing and Recruiting"]],
  [/real estate/i, ["Real Estate"]],
  [/education|e-?learning/i, ["E-Learning Providers", "Education"]],
  [/manufactur/i, ["Manufacturing"]],
  [/logistic|supply chain/i, ["Transportation, Logistics, Supply Chain and Storage"]],
  [/media|publish/i, ["Online Audio and Video Media", "Book and Periodical Publishing"]],
  [/ai\b|artificial intelligence|machine learning/i, ["Technology, Information and Internet", "Software Development"]],
];

/** LinkedIn industries of service businesses (agencies, consultancies, IT services, staffing). */
export const SERVICE_INDUSTRIES = ["IT Services and IT Consulting", "Business Consulting and Services", "Marketing Services", "Advertising Services",
  "Staffing and Recruiting", "Outsourcing and Offshoring Consulting", "Strategic Management Services", "Human Resources Services", "Operations Consulting"];

export function linkedinIndustries(labels: string[], known: Set<string> = KNOWN_INDUSTRIES): string[] {
  const out: string[] = [];
  for (const label of labels) {
    if (known.has(label)) { out.push(label); continue; }
    for (const [re, names] of INDUSTRY_ALIASES) if (re.test(label)) out.push(...names);
  }
  return uniq(out, 30);
}

/** The Icypeas filter object for an ICP. Null when the ICP has no titles to search for. */
export function icypeasQuery(icp: Icp, opts: { industries?: boolean } = {}): Obj | null {
  const titles = uniq(icp.personas.flatMap((p) => p.titles), 40);
  if (!titles.length) return null;
  // Exclusions are written for people ("intern", "recruiter"), not as company descriptions.
  const titleExclusions = uniq(icp.exclusions.filter((x) => x.split(/\s+/).length <= 3), 40);
  const q: Obj = { currentJobTitle: { include: titles, ...(titleExclusions.length ? { exclude: titleExclusions } : {}) } };
  const geos = uniq(icp.geographies, 20);
  if (geos.length) q.location = { include: geos };
  // When the ICP excludes service providers, don't pay for people at agencies and IT/consulting
  // firms that scoring would reject anyway.
  const noServices = excludesServiceProviders(icp);
  const industries = (opts.industries === false ? [] : linkedinIndustries(icp.industries)).filter((i) => !noServices || !SERVICE_INDUSTRIES.includes(i));
  if (industries.length) q["currentCompany.industry"] = { include: industries, ...(noServices ? { exclude: SERVICE_INDUSTRIES } : {}) };
  else if (noServices) q["currentCompany.industry"] = { exclude: SERVICE_INDUSTRIES };
  const range = headcountRange(icp.company_sizes);
  if (range) q["currentCompany.headcount"] = range;
  return q;
}

export function leadFromRow(o: Obj): LeadCandidate | null {
  const company = isObj(o.currentCompany) ? (o.currentCompany as Obj) : null;
  const name = str(o.name) ?? ([str(o.firstname), str(o.lastname)].filter(Boolean).join(" ") || null);
  const url = profileUrlFor(str(o.url) ?? str(o.linkedinUrl) ?? str(o.profileUrl));
  if (!name || !url) return null;
  const companyName = str(o.lastCompanyName) ?? str(o.currentCompanyName) ?? (company ? str(company.name) : null);
  const size = typeof o.lastCompanySize === "number" ? o.lastCompanySize : null;
  return {
    name, firstName: str(o.firstname), lastName: str(o.lastname), headline: str(o.headline), profileUrl: url,
    title: str(o.lastJobTitle) ?? str(o.currentJobTitle) ?? str(o.title),
    company: companyName,
    location: str(o.address) ?? str(o.location),
    summary: str(o.description),
    // Firmographics ride along so the lead can be scored on company size and industry.
    companyInfo: companyName ? {
      name: companyName, website: str(o.lastCompanyWebsite), industry: str(o.lastCompanyIndustry), employeeCount: size,
      description: str(o.lastCompanyDescription), linkedinUrl: str(o.lastCompanyUrl), location: str(o.lastCompanyAddress),
    } : null,
  };
}

/** One page of matching people. Pass the returned token back for the next page. */
async function searchOnce(workspaceId: string, query: Obj, size: number, token?: string | null) {
  const pagination: Obj = { size: Math.min(200, Math.max(1, size)) };
  if (token) pagination.token = token;
  const r = await tregCall<Obj>("icypeas.people.search", { workspaceId, purpose: "people_search", body: { query, pagination }, maxCostUsd: Math.max(0.01, size * 0.0005) });
  const body = isObj(r.data) && isObj(r.data.output) ? r.data.output : r.data;
  const rows = (isObj(body) && Array.isArray(body.leads) ? body.leads : []) as Obj[];
  const next = isObj(body) && isObj(body.pagination) ? str((body.pagination as Obj).token) : null;
  return { leads: rows.map(leadFromRow).filter((l): l is LeadCandidate => !!l), token: next, total: isObj(body) && typeof body.total === "number" ? body.total : null };
}

/**
 * One page of matching people. Pass the returned token back for the next page. When the
 * industry filter matches nobody (an empty search costs nothing), searches again without it
 * and lets scoring judge the industry instead.
 */
export async function tregPeopleSearch(workspaceId: string, icp: Icp, size: number, token?: string | null): Promise<{ leads: LeadCandidate[]; token: string | null; total: number | null }> {
  const query = icypeasQuery(icp);
  if (!query) throw new Error("Add persona job titles to the agent's targeting to search for lookalike leads");
  const first = await searchOnce(workspaceId, query, size, token);
  const industryFilter = query["currentCompany.industry"] as { include?: string[] } | undefined;
  if (first.leads.length || token || !industryFilter?.include) return first;
  return searchOnce(workspaceId, icypeasQuery(icp, { industries: false })!, size);
}

/**
 * The ICP's persona titles at one company (a funded company, a hiring one…), found by its website
 * domain when known, else its name. Rows are paid (~$0.0004 each): ask for a handful.
 */
export async function tregPeopleAtCompany(workspaceId: string, icp: Icp, company: { name: string; domain?: string | null }, size = 3): Promise<LeadCandidate[]> {
  const base = icypeasQuery(icp, { industries: false });
  if (!base) return [];
  const query: Obj = { currentJobTitle: base.currentJobTitle };
  if (company.domain) query.currentCompanyWebsite = { include: [company.domain] };
  else query.currentCompanyName = { include: [company.name] };
  return (await searchOnce(workspaceId, query, Math.max(1, Math.min(10, size)))).leads;
}
