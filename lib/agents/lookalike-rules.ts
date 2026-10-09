/**
 * Pure rules for the Warm Lookalike source: read a seed profile from LinkedIn's own page data,
 * turn the chosen scope into a Sales Navigator search, and rank what comes back. No Node or
 * DB imports: the wizard uses the types and the URL check in the browser.
 */

export interface LookalikeProfile {
  name: string;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  /** Sales Navigator REGION filter id (the profile's fsd_geo id). */
  geoId: string | null;
  industry: string | null;
  /** Sales Navigator INDUSTRY filter id (the profile's fsd_industry id). */
  industryId: string | null;
  photo: string | null;
  linkedinUrl: string;
}

export interface LookalikeScope {
  title: string;
  /** Extra titles searched when similar roles are on. */
  similarTitles: string[];
  includeSimilarRoles: boolean;
  location: string | null;
  geoId: string | null;
  industry: string | null;
  industryId: string | null;
  /** On: don't restrict the search to the seed's industry, only rank by it. */
  relatedIndustries: boolean;
  /** SIZE_PRESETS values, e.g. "201-500". Empty = all sizes. */
  sizes: string[];
}

export interface LookalikeLead {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  industry: string | null;
  photo: string | null;
  url: string | null;
  /** 0–100 similarity to the scope. */
  match: number;
}

/** What the search returns per person (a subset of the Sales Navigator scrape). */
export interface LookalikeCandidate {
  salesNavUrn: string; salesNavUrl: string; fullName: string | null; title: string | null; company: string | null;
  location: string | null; companyIndustry: string | null; profileImageUrl: string | null; linkedinUrl: string | null;
}

const PROFILE_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/** The public id ("nilesh-yadav-123") of a LinkedIn /in/ URL, or null when it isn't one. */
export function publicIdFromUrl(input: string): string | null {
  const m = input.trim().match(PROFILE_RE);
  if (!m) return null;
  const id = decodeURIComponent(m[1]).trim();
  return /^[\p{L}\p{N}_.-]{3,100}$/u.test(id) ? id : null;
}

/** Sales Navigator company headcount filter codes. */
const HEADCOUNT: Record<string, string> = {
  "1-10": "B", "11-50": "C", "51-200": "D", "201-500": "E", "501-1000": "F", "1001-5000": "G", "5001-10000": "H", "10000+": "I",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const idOf = (urn: unknown): string | null => (typeof urn === "string" ? urn.match(/:(\d+)\)?$/)?.[1] ?? null : null);

/** Every object in a LinkedIn JSON payload (normalized `included` entries and nested data). */
function collect(value: unknown, out: Obj[], depth = 0): void {
  if (depth > 12 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const v of value) collect(v, out, depth + 1); return; }
  out.push(value as Obj);
  for (const v of Object.values(value as Obj)) if (v && typeof v === "object") collect(v, out, depth + 1);
}

/**
 * Pull the seed person out of the voyager responses a profile page loads. `image` turns
 * LinkedIn's vector image shape into a URL (lib/linkedin/images, injected to stay pure).
 */
export function parseFlagshipProfile(bodies: string[], publicId: string, image: (img: unknown) => string | null = () => null): LookalikeProfile | null {
  const objs: Obj[] = [];
  for (const body of bodies) {
    try { collect(JSON.parse(body), objs); } catch { /* not JSON */ }
  }
  const byUrn = new Map<string, Obj>();
  for (const o of objs) if (typeof o.entityUrn === "string" && !byUrn.has(o.entityUrn)) byUrn.set(o.entityUrn, o);

  const want = publicId.toLowerCase();
  const profile = objs.find((o) => typeof o.publicIdentifier === "string" && o.publicIdentifier.toLowerCase() === want && (str(o.firstName) || str(o.lastName)));
  if (!profile) return null;

  const name = [str(profile.firstName), str(profile.lastName)].filter(Boolean).join(" ");
  const headline = str(profile.headline);

  const geo = isObj(profile.geoLocation) ? profile.geoLocation : null;
  const geoUrn = str(geo?.geoUrn) ?? str(geo?.["*geo"]) ?? str(profile.geoUrn);
  const geoEntity = geoUrn ? byUrn.get(geoUrn) : undefined;
  const location = str(geoEntity?.defaultLocalizedName) ?? str(isObj(geo?.geo) ? geo.geo.defaultLocalizedName : null) ?? str(profile.locationName) ?? str(profile.geoLocationName);

  const industryUrn = str(profile.industryUrn) ?? str(profile["*industry"]) ?? (isObj(profile.industry) ? str(profile.industry.entityUrn) : null);
  const industryEntity = industryUrn ? byUrn.get(industryUrn) : undefined;
  const industry = str(industryEntity?.name) ?? (isObj(profile.industry) ? str(profile.industry.name) : null) ?? str(profile.industryName);

  const positions = objs.filter((o) => typeof o.$type === "string" && /\.Position$/.test(o.$type) && str(o.title));
  const current = positions.find((p) => !(isObj(p.dateRange) && p.dateRange.end)) ?? positions[0];
  const fromHeadline = headline?.split(/\s+(?:at|@)\s+|\s*\|\s*/i) ?? [];
  const title = str(current?.title) ?? str(fromHeadline[0]);
  const company = str(current?.companyName) ?? (fromHeadline.length > 1 ? str(fromHeadline[1]) : null);

  return {
    name: name || publicId, headline, title, company, location, geoId: idOf(geoUrn), industry, industryId: idOf(industryUrn),
    photo: image(profile.profilePicture), linkedinUrl: `https://www.linkedin.com/in/${publicId}/`,
  };
}

/** Titles the search uses: the seed's, plus similar roles when switched on. */
export function scopeTitles(scope: LookalikeScope): string[] {
  const all = [scope.title, ...(scope.includeSimilarRoles ? scope.similarTitles : [])].map(cleanText).filter(Boolean);
  return [...new Map(all.map((t) => [t.toLowerCase(), t])).values()].slice(0, 10);
}

/** Rest.li-safe text: the query syntax reserves ( ) , : so they are dropped from free text. */
function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/[(),:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Ad hoc Sales Navigator people search for the scope (the importer and preview both read it). */
export function lookalikeSearchUrl(scope: LookalikeScope, opts: { withIndustry?: boolean } = {}): string {
  const filters: string[] = [];
  const titles = scopeTitles(scope);
  if (titles.length) filters.push(`(type:CURRENT_TITLE,values:List(${titles.map((t) => `(text:${encodeURIComponent(t)},selectionType:INCLUDED)`).join(",")}))`);
  if (scope.geoId) filters.push(`(type:REGION,values:List((id:${scope.geoId},text:${encodeURIComponent(cleanText(scope.location))},selectionType:INCLUDED)))`);
  if ((opts.withIndustry ?? !scope.relatedIndustries) && scope.industryId) {
    filters.push(`(type:INDUSTRY,values:List((id:${scope.industryId},text:${encodeURIComponent(cleanText(scope.industry))},selectionType:INCLUDED)))`);
  }
  const sizes = scope.sizes.map((s) => HEADCOUNT[s]).filter(Boolean);
  if (sizes.length) filters.push(`(type:COMPANY_HEADCOUNT,values:List(${sizes.map((c) => `(id:${c},selectionType:INCLUDED)`).join(",")}))`);
  return `https://www.linkedin.com/sales/search/people?query=(spellCorrectionEnabled:true,filters:List(${filters.join(",")}))`;
}

const words = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)));
const STOP = new Set(["of", "and", "the", "at", "in", "for", "to", "&"]);
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(a.size, b.size);
};

/** 0–100: title 50, location 25, industry 25. Missing scope parts give full credit. */
export function matchScore(c: Pick<LookalikeCandidate, "title" | "location" | "companyIndustry">, scope: LookalikeScope): number {
  const titles = scopeTitles(scope);
  const title = titles.length ? Math.max(...titles.map((t) => overlap(words(t), words(c.title)))) : 1;
  const loc = scope.location ? overlap(words(scope.location), words(c.location)) : 1;
  const ind = scope.industry ? overlap(words(scope.industry), words(c.companyIndustry)) : 1;
  // A title that only shares a seniority word still reads as related, not as a miss.
  const titlePts = title >= 0.99 ? 50 : 30 + title * 20;
  return Math.round(Math.min(100, titlePts + 25 * Math.min(1, loc * 1.5) + 25 * Math.min(1, ind * 1.5)));
}

/** Best matches first, the seed person and duplicates dropped. */
export function rankLookalikes(found: LookalikeCandidate[], scope: LookalikeScope, seedName: string | null, limit = 5): LookalikeLead[] {
  const seen = new Set<string>();
  const seed = seedName?.trim().toLowerCase() ?? "";
  return found
    .filter((c) => {
      if (!c.salesNavUrn || seen.has(c.salesNavUrn)) return false;
      seen.add(c.salesNavUrn);
      return !(seed && c.fullName?.trim().toLowerCase() === seed);
    })
    .map((c) => ({
      id: c.salesNavUrn, name: c.fullName ?? "LinkedIn member", title: c.title, company: c.company, location: c.location,
      industry: c.companyIndustry, photo: c.profileImageUrl, url: c.linkedinUrl ?? c.salesNavUrl ?? null, match: matchScore(c, scope),
    }))
    .sort((a, b) => b.match - a.match)
    .slice(0, limit);
}
