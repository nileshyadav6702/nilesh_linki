import type Database from "better-sqlite3";
import { tregEnabled } from "@/lib/treg/client";
import { tregFetchPages, type WebPage } from "@/lib/treg/web";

/**
 * Finds the job board a company uses (Greenhouse, Lever, Ashby) from its careers page, so "Job
 * openings" works without anyone typing board slugs: the open roles then come from the boards'
 * free public APIs. Pages are read through treg's free fetch (plain fetch without treg).
 */

export type Ats = "greenhouse" | "lever" | "ashby";
export interface FoundBoard { ats: Ats; slug: string; company: string }

const BOARD_PATTERNS: Array<[Ats, RegExp]> = [
  ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i],
  ["greenhouse", /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i],
  ["lever", /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/i],
  ["ashby", /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i],
];
const NOT_SLUGS = new Set(["embed", "api", "v1", "jobs", "job_board", "js", "careers"]);

/** The job board a careers page links to or embeds, if any. */
export function boardFromPage(links: string[], text: string): { ats: Ats; slug: string } | null {
  for (const hay of [...links, text]) {
    for (const [ats, re] of BOARD_PATTERNS) {
      const m = hay.match(re);
      const slug = m?.[1] ? decodeURIComponent(m[1]).replace(/\/$/, "") : null;
      if (slug && !NOT_SLUGS.has(slug.toLowerCase())) return { ats, slug };
    }
  }
  return null;
}

/** Careers pages to try for a domain, in order. */
export const careersUrls = (domain: string) => [`https://${domain}/careers`, `https://${domain}/jobs`, `https://${domain}/`];

async function plainFetch(urls: string[]): Promise<Map<string, WebPage | null>> {
  const out = new Map<string, WebPage | null>();
  for (const u of urls) {
    try {
      const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; KairoBot/1.0)" } });
      if (!res.ok) { out.set(u, null); continue; }
      const html = (await res.text()).slice(0, 1_000_000);
      const links = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((m) => m[1]);
      out.set(u, { url: u, finalUrl: res.url, title: null, description: null, text: html, links });
    } catch { out.set(u, null); }
  }
  return out;
}

const RECHECK_DAYS = 14;
type Discovered = Record<string, { at: string; board: { ats: Ats; slug: string } | null; company: string }>;

/**
 * Companies of the agent's leads (qualified first) whose job board isn't known yet: read their
 * careers pages and remember what was found (or that nothing was) for two weeks.
 */
export async function discoverBoards(db: Database.Database, workspaceId: string, agentId: string, cursor: Record<string, unknown>, perRun: number): Promise<FoundBoard[]> {
  const known = (cursor.discovered as Discovered | undefined) ?? {};
  const fresh = (d: string) => known[d] && Date.now() - Date.parse(known[d].at) < RECHECK_DAYS * 86_400_000;
  const companies = db.prepare(`SELECT c.name, COALESCE(c.domain, c.website) site, MAX(CASE WHEN t.agent_status IN ('qualified','drafted','approved','enrolled') THEN 1 ELSE 0 END) good
      FROM targets t JOIN companies c ON c.id = t.company_id
     WHERE t.agent_id = ? AND COALESCE(c.domain, c.website) IS NOT NULL
     GROUP BY c.id ORDER BY good DESC, MAX(t.created_at) DESC LIMIT 200`).all(agentId) as Array<{ name: string; site: string }>;
  const todo: Array<{ name: string; domain: string }> = [];
  for (const c of companies) {
    let domain: string | null = null;
    try { domain = new URL(/^https?:\/\//.test(c.site) ? c.site : `https://${c.site}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* skip */ }
    if (domain && !fresh(domain) && !todo.some((t) => t.domain === domain)) todo.push({ name: c.name, domain });
    if (todo.length >= perRun) break;
  }
  if (todo.length) {
    const urls = todo.flatMap((t) => careersUrls(t.domain));
    const pages = tregEnabled() ? await tregFetchPages(workspaceId, urls) : await plainFetch(urls);
    for (const t of todo) {
      let board: { ats: Ats; slug: string } | null = null;
      for (const u of careersUrls(t.domain)) {
        const p = pages.get(u);
        if (p && (board = boardFromPage(p.links, p.text))) break;
      }
      known[t.domain] = { at: new Date().toISOString(), board, company: t.name };
    }
  }
  // Keep the newest 500 entries.
  cursor.discovered = Object.fromEntries(Object.entries(known).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, 500));
  return Object.values(cursor.discovered as Discovered).filter((d) => d.board).map((d) => ({ ...d.board!, company: d.company }));
}
