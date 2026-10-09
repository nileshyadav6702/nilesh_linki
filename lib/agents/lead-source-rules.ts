/**
 * Pure rules for the "Lead sources" drawer, shared by the browser and the API so both
 * validate and count the same way. No Node or DB imports: this file ships to the client.
 */

/** Source types the drawer edits as "live signals" (one row per type, config on the row). */
export const DRAWER_SIGNAL_TYPES = [
  "competitor_engagement", "keyword_engagement", "influencer_engagement", "own_content_engagement",
  "job_change", "funding", "hiring", "lookalike",
] as const;
export type DrawerSignalType = (typeof DRAWER_SIGNAL_TYPES)[number];

export function isDrawerSignalType(v: unknown): v is DrawerSignalType {
  return typeof v === "string" && (DRAWER_SIGNAL_TYPES as readonly string[]).includes(v);
}

/**
 * Signals one agent may track. Each tracked page costs ~4 LinkedIn reads per run (feed + 3
 * posts' reactions) and sources run twice a day, so 15 keeps an agent inside its account's
 * daily voyager_read budget (120). Only adding beyond it is refused; older agents above it keep working.
 */
export const SIGNAL_BUDGET = 15;

export const MAX_TOPIC_WORDS = 3;

export interface SignalDraftConfig {
  urls?: string[];
  keywords?: string[];
  boards?: Array<{ ats: "greenhouse" | "lever" | "ashby"; slug: string; company?: string }>;
  role_keywords?: string[];
}
export interface SignalDraft { enabled: boolean; config: SignalDraftConfig }

/** How many signals one source contributes: each URL / topic once, each switched-on event once. */
export function signalsFor(type: string, s: SignalDraft | undefined): number {
  if (!s?.enabled) return 0;
  const c = s.config;
  if (type === "keyword_engagement") return c.keywords?.length ?? 0;
  if (type === "competitor_engagement" || type === "influencer_engagement" || type === "own_content_engagement") return c.urls?.length ?? 0;
  if (type === "job_change" || type === "funding" || type === "hiring" || type === "lookalike") return 1;
  return 0;
}

export function countSignals(sources: Partial<Record<string, SignalDraft>>): number {
  return Object.entries(sources).reduce((n, [type, s]) => n + signalsFor(type, s), 0);
}

const COMPANY_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(company|showcase)\/([^/?#\s]+)\/?(?:[?#].*)?$/i;
const PROFILE_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/** "linkedin.com/company/lemlist/about" style input → canonical company URL, or null. */
export function normalizeCompanyUrl(input: string): string | null {
  const m = input.trim().replace(/\/(about|posts|people|jobs|life)\/?$/i, "").match(COMPANY_RE);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}` : null;
}

/** LinkedIn /in/ URL → canonical profile URL, or null. */
export function normalizeProfileUrlStrict(input: string): string | null {
  const m = input.trim().match(PROFILE_RE);
  // LinkedIn's internal ids ("ACoAAB…") are case-sensitive; public handles are not.
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  return `https://www.linkedin.com/in/${/^ACo[A-Za-z0-9_-]{20,}$/.test(slug) ? slug : slug.toLowerCase()}`;
}

/** Profile or company page (own content can be either). */
export function normalizePageUrl(input: string): string | null {
  return normalizeProfileUrlStrict(input) ?? normalizeCompanyUrl(input);
}

/** Best-guess company page for a plain name: "Acme Inc" → linkedin.com/company/acme-inc. */
export function companyUrlFromName(name: string): string | null {
  const slug = name.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? `https://www.linkedin.com/company/${slug}` : null;
}

/** "linkedin.com/company/lemlist" for display. */
export const shortLinkedIn = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Slug of a company / profile URL, humanised: ".../company/acme-labs" → "Acme Labs". */
export function labelFromUrl(url: string): string {
  const slug = url.replace(/\/$/, "").split("/").pop() ?? url;
  return decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Split "a, b, c" into topics; each must be 2-80 chars and at most 3 words. */
export function parseTopics(input: string): { topics: string[]; error: string | null } {
  const parts = input.split(",").map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  for (const p of parts) {
    if (p.length < 2) return { topics: [], error: `"${p}" is too short` };
    if (p.length > 80) return { topics: [], error: "Topics are 80 characters at most" };
    if (p.split(" ").length > MAX_TOPIC_WORDS) return { topics: [], error: `"${p}" has more than ${MAX_TOPIC_WORDS} words` };
  }
  return { topics: parts, error: null };
}

/** Activity id of a LinkedIn post URL (feed/update/urn:li:activity:… or /posts/…-activity-…). */
export function postActivityId(url: string): string | null {
  if (!/linkedin\.com\//i.test(url)) return null;
  return url.match(/activity[:-](\d{15,})/i)?.[1] ?? null;
}

/** A Sales Navigator URL the importer can read (lib/linkedin/scraper.ts scrapeNavigatorUrl). */
export function isSalesNavUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\/(www\.)?linkedin\.com\/sales\//i.test(u)) return false;
  return /\/sales\/lists\/people\/\d+/.test(u) || /[?&]savedSearchId=\d+/.test(u) || (/\/sales\/search\/people\?/.test(u) && /[?&]query=/.test(u));
}
