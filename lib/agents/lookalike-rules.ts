/**
 * Pure rules for the Warm Lookalike source: read a seed profile from LinkedIn's own page data,
 * turn the chosen scope into a Sales Navigator search, and rank what comes back. No Node or
 * DB imports: the wizard uses the types and the URL check in the browser.
 */

import { INDUSTRY_TREE } from "@/lib/icp/data/industries";
import { sizeKey } from "@/lib/icp/targeting";

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
  /** The current employer's LinkedIn page, when the Experience section links it. */
  companyUrl?: string | null;
  /** The employer's headcount as a SIZE_PRESETS value ("201-500 employees"). */
  companySize?: string | null;
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

const INDUSTRIES = new Set(INDUSTRY_TREE.flatMap((n) => [n.label, ...(n.children ?? [])]).map((x) => x.toLowerCase()));

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

/** An Experience entry on a profile page: the company link and the text inside it. */
export interface ExperienceLink { href: string; text: string }

const DATES = /\b(19|20)\d{2}\b|\bPresent\b/;
const DURATION = /\b\d+\s+(yrs?|mos?)\b/g;

/**
 * Current role from the profile's Experience links. A single role reads "Title / Company ·
 * Full-time / Sep 2025 - Present"; several roles at one company read "Company / Full-time ·
 * 5 yrs / Title / dates…". Links without dates (people/pages suggestions) are ignored.
 */
export function currentRoleFromExperience(links: ExperienceLink[]): { title: string | null; company: string | null; companyUrl: string | null } | null {
  const entries = links
    .map((l) => ({ href: l.href, lines: l.text.split("\n").map((x) => x.trim()).filter(Boolean) }))
    .filter((e) => e.lines.length >= 2 && DATES.test(e.lines.join(" ")) && !/followers/i.test(e.lines.join(" ")));
  const pick = entries.find((e) => /\bPresent\b/.test(e.lines.join(" "))) ?? entries[0];
  if (!pick) return null;
  const [a, b, c] = pick.lines;
  // Grouped roles: the second line is "Full-time · 5 yrs", a duration with no date range in it.
  const grouped = new RegExp(DURATION.source).test(b) && !DATES.test(b.replace(DURATION, ""));
  const base = pick.href.match(/^https?:\/\/(?:www\.)?linkedin\.com\/company\/[^/?#]+/i)?.[0];
  const companyUrl = base ? `${base}/` : null;
  return grouped
    ? { title: c && !DATES.test(c) ? c : null, company: a, companyUrl }
    : { title: a, company: b.split(" · ")[0].trim() || null, companyUrl };
}

/** "201-500 employees" / "10,001+ employees" / "2-10 employees" → the SIZE_PRESETS value it falls in ("201-500 employees"). */
export function sizeBucket(text: string | null | undefined): string | null {
  const m = (text ?? "").replace(/,/g, "").match(/(\d+)\s*(?:[-–]\s*(\d+)|\+)?\s*employees/i);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const range = n <= 10 ? "1-10" : n <= 50 ? "11-50" : n <= 200 ? "51-200" : n <= 500 ? "201-500" : n <= 1000 ? "501-1000" : n <= 5000 ? "1001-5000" : n <= 10000 ? "5001-10000" : "10000+";
  return `${range} employees`;
}

/** Industry and headcount from a company page's top-card items ("IT Services…", "New Delhi", "5K followers", "201-500 employees"). */
export function companyFacts(items: string[]): { industry: string | null; size: string | null } {
  const clean = items.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const size = sizeBucket(clean.find((x) => /employees/i.test(x)));
  // The card also holds the name, a "formerly known as" line and the HQ city, so trust LinkedIn's
  // industry list first; else take the item just before the city ("Industry · City · followers").
  const known = clean.find((x) => INDUSTRIES.has(x.toLowerCase()));
  const followersAt = clean.findIndex((x) => /followers/i.test(x));
  const beforeCity = followersAt >= 2 ? clean[followersAt - 2] : null;
  const industry = known ?? (beforeCity && !/followers|employees|formerly/i.test(beforeCity) && beforeCity.length <= 80 ? beforeCity : null);
  return { industry, size };
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
  const sizes = scope.sizes.map((s) => HEADCOUNT[sizeKey(s)]).filter(Boolean);
  if (sizes.length) filters.push(`(type:COMPANY_HEADCOUNT,values:List(${sizes.map((c) => `(id:${c},selectionType:INCLUDED)`).join(",")}))`);
  return `https://www.linkedin.com/sales/search/people?query=(spellCorrectionEnabled:true,filters:List(${filters.join(",")}))`;
}

/**
 * Regular LinkedIn people search for the scope, for accounts without Sales Navigator. Title
 * filters are Premium-only there, so titles go in as a boolean keyword query; the city joins
 * the keywords unless a geo id can filter by place.
 */
export function flagshipSearchUrl(scope: LookalikeScope, page = 1): string {
  const titles = scopeTitles(scope).slice(0, 5);
  const titleQuery = titles.length > 1 ? `(${titles.map((t) => `"${t}"`).join(" OR ")})` : titles[0] ? `"${titles[0]}"` : "";
  const city = scope.geoId ? "" : cleanText(scope.location?.split(",")[0]);
  const params = new URLSearchParams({ keywords: [titleQuery, city].filter(Boolean).join(" "), origin: "FACETED_SEARCH" });
  if (scope.geoId) params.set("geoUrn", `["${scope.geoId}"]`);
  if (page > 1) params.set("page", String(page));
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

export const isFlagshipSearchUrl = (u: string) => /linkedin\.com\/search\/results\/people\/?\?/i.test(u);

/** One result card from the people search page: the profile link and the card's text. */
export interface SearchCard { href: string; text: string; photo?: string | null }

const NOISE = /^(•\s*)?(1st|2nd|3rd\+?)$|^(Connect|Message|Follow|Following|Pending)$|followers$|mutual connection|^Status is|^View .+ profile$/i;

/** People search cards → candidates (title and company from the "Current:" line, else the headline). */
export function parseSearchCards(cards: SearchCard[]): LookalikeCandidate[] {
  const out: LookalikeCandidate[] = [];
  for (const card of cards) {
    const url = card.href.match(/^https?:\/\/(?:www\.)?linkedin\.com\/in\/[^/?#]+/i)?.[0];
    if (!url) continue;
    const lines = card.text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const name = lines[0]?.split(/\s+•\s+/)[0].trim();
    if (!name || /^LinkedIn Member$/i.test(name)) continue;
    const rest = lines.slice(1).filter((l) => !NOISE.test(l) && !l.startsWith("Past:"));
    const currentLine = rest.find((l) => /^Current:/i.test(l));
    const [headline, location] = rest.filter((l) => l !== currentLine);
    const current = currentLine?.replace(/^Current:\s*/i, "").match(/^(.*?)\s+at\s+(.+)$/i);
    const fromHeadline = headline?.split(/\s+(?:at|@)\s+/i) ?? [];
    out.push({
      salesNavUrn: `${url}/`, salesNavUrl: `${url}/`, linkedinUrl: `${url}/`, fullName: name,
      title: current?.[1]?.trim() || fromHeadline[0]?.trim() || null,
      company: current?.[2]?.trim() || (fromHeadline.length > 1 ? fromHeadline[1].trim() : null),
      location: location ?? null, companyIndustry: null, profileImageUrl: card.photo ?? null,
    });
  }
  return out;
}

/** Title abbreviations spelled out, so "VP Sales" and "Vice President of Sales" compare equal. */
const ABBR: Record<string, string> = {
  vp: "vice president", svp: "senior vice president", evp: "executive vice president", avp: "assistant vice president",
  cso: "chief sales officer", cro: "chief revenue officer", ceo: "chief executive officer", cto: "chief technology officer",
  cfo: "chief financial officer", coo: "chief operating officer", cmo: "chief marketing officer", md: "managing director",
  gm: "general manager", sr: "senior", jr: "junior", mgr: "manager", bd: "business development",
};
const words = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .flatMap((w) => (ABBR[w] ?? w).split(" ")).filter((w) => w.length > 1 && !STOP.has(w)));
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
  const locPts = 25 * Math.min(1, loc * 1.5);
  // Regular LinkedIn search shows no industry: score on title and place alone, scaled to 100.
  if (scope.industry && !c.companyIndustry) return Math.round(Math.min(100, ((titlePts + locPts) / 75) * 100));
  return Math.round(Math.min(100, titlePts + locPts + 25 * Math.min(1, ind * 1.5)));
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
