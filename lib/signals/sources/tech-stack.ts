import type { SourceRunner } from "@/lib/signals/sources/types";
import { prefilterLead } from "@/lib/signals/leads";
import { tregEnabled } from "@/lib/treg/client";
import { tregPeopleSearch } from "@/lib/treg/people";
import { TECHNOLOGIES } from "@/lib/signals/tech-catalog";

/**
 * Tech stack: finds people at ICP companies whose website runs a technology the agent tracks.
 * Websites are read once (homepage HTML + response headers) and matched against known
 * fingerprints (script hosts, globals, generator tags); results are cached per domain.
 */

/** Homepages read per run, and how long a domain's detected stack is trusted. */
const SITES_PER_RUN = 25;
const CACHE_DAYS = 30;
const MAX_CACHED = 600;
const PEOPLE_PER_RUN = 40;

export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch { return null; }
}

/** Technologies (catalog names) found in a page's HTML and headers. */
export function detectTechnologies(html: string, headers: Record<string, string> = {}): string[] {
  const head = Object.entries(headers).map(([k, v]) => `${k.toLowerCase()}: ${v}`).join("\n").toLowerCase();
  const body = html.toLowerCase();
  return TECHNOLOGIES.filter((t) => t.html.some((p) => body.includes(p)) || (t.headers ?? []).some((p) => head.includes(p))).map((t) => t.name);
}

/** Fetch a homepage and detect its stack. Null when the site can't be read. */
export async function siteStack(domain: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`https://${domain}`, {
      redirect: "follow", signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KairoTechCheck/1.0)", Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 1_500_000);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return detectTechnologies(html, headers);
  } catch { return null; }
}

type Cache = Record<string, { at: string; tech: string[] | null }>;

/** The tracked names that a cached-or-fresh stack contains (case-insensitive). */
const wanted = (tracked: string[], stack: string[]) => stack.filter((s) => tracked.some((t) => t.toLowerCase() === s.toLowerCase()));

export const techStackRunner: SourceRunner = async (ctx) => {
  const tracked = ctx.config.keywords;
  if (!tracked.length) return;
  const cache: Cache = (ctx.cursor.sites as Cache | undefined) ?? {};
  const fresh = (d: string) => cache[d] && Date.now() - Date.parse(cache[d].at) < CACHE_DAYS * 86_400_000;
  let reads = 0;
  async function stackOf(domain: string): Promise<string[] | null> {
    if (fresh(domain)) return cache[domain].tech;
    if (reads >= SITES_PER_RUN) return null;
    reads++;
    const tech = await siteStack(domain);
    cache[domain] = { at: new Date().toISOString(), tech };
    return tech;
  }

  // Contacts the agent already has: tag their company.
  const known = ctx.db.prepare(`SELECT t.id, COALESCE(c.domain, c.website) site, c.technology_names FROM targets t JOIN companies c ON c.id = t.company_id
    WHERE t.agent_id = ? AND COALESCE(c.domain, c.website, c.technology_names) IS NOT NULL ORDER BY t.created_at DESC LIMIT 200`)
    .all(ctx.agent.id) as Array<{ id: string; site: string | null; technology_names: string | null }>;
  for (const k of known) {
    const domain = domainOf(k.site);
    // Enrichment may already list the company's technologies; the website fills in the rest.
    const enriched = (k.technology_names ?? "").split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const site = domain && (fresh(domain) || reads < SITES_PER_RUN) ? (await stackOf(domain)) ?? [] : [];
    for (const tech of wanted(tracked, [...new Set([...enriched, ...site])])) {
      ctx.emitForTarget(k.id, { type: "technology", title: `Company uses ${tech}`, sourceUrl: domain ? `https://${domain}` : null, dedupeKey: `tech:${k.id}:${tech.toLowerCase()}`, metadata: { technology: tech, domain } });
    }
  }

  // New people at ICP companies (people database), when one is configured.
  if (tregEnabled() && ctx.icp && reads < SITES_PER_RUN) {
    const r = await tregPeopleSearch(ctx.workspaceId, ctx.icp, PEOPLE_PER_RUN, (ctx.cursor.treg_token as string | undefined) ?? null);
    ctx.cursor.treg_token = r.token;
    for (const p of r.leads) {
      if (ctx.isFull()) break;
      const domain = domainOf(p.companyInfo?.website);
      if (!domain || !prefilterLead(p, { icp: ctx.icp }).ok) continue;
      const hits = wanted(tracked, (await stackOf(domain)) ?? []);
      if (!hits.length) continue;
      ctx.emitLead(p, {
        type: "technology", title: `${p.company ?? "Their company"} uses ${hits.join(", ")}`, sourceUrl: `https://${domain}`,
        dedupeKey: `tech:${ctx.agent.id}:${p.profileUrl}:${hits.map((h) => h.toLowerCase()).sort().join("+")}`, metadata: { technologies: hits, domain },
      });
    }
  }

  // Keep the cache bounded: newest first.
  ctx.cursor.sites = Object.fromEntries(Object.entries(cache).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, MAX_CACHED));
};

