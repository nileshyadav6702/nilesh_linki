import { tregCall } from "@/lib/treg/client";

/**
 * Web pages and news through treg, cheapest first:
 *  - pages: TinyFish fetch (free, up to 10 URLs a call), then Crawl4AI ($0.00015 a page, renders
 *    JavaScript, failures free) only for pages TinyFish could not read — never a router that
 *    bills misses.
 *  - news: Exa news search ($0.007 a call, up to 10 results), titles only (no paid contents).
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface WebPage { url: string; finalUrl: string; title: string | null; description: string | null; text: string; links: string[] }

function pageOf(o: Obj, url: string): WebPage | null {
  const text = str(o.text) ?? str(o.markdown) ?? str(o.content) ?? str(o.md) ?? "";
  const links = Array.isArray(o.links) ? (o.links as unknown[]).map((l) => (typeof l === "string" ? l : isObj(l) ? str(l.href) ?? str(l.url) : null)).filter((l): l is string => !!l) : [];
  if (!text && !links.length) return null;
  return { url, finalUrl: str(o.final_url) ?? str(o.finalUrl) ?? url, title: str(o.title), description: str(o.description), text, links };
}

/** The first object (depth-first) that looks like a page. */
function findPage(data: unknown, url: string, depth = 0): WebPage | null {
  if (depth > 4) return null;
  if (isObj(data)) {
    const p = pageOf(data, url);
    if (p) return p;
    for (const v of Object.values(data)) { const f = findPage(v, url, depth + 1); if (f) return f; }
  } else if (Array.isArray(data)) for (const v of data) { const f = findPage(v, url, depth + 1); if (f) return f; }
  return null;
}

/**
 * Read pages. Returns one entry per URL: the page, or null when it doesn't exist or could not
 * be read. `fallback` lets pages TinyFish could not read (blocked, needs JavaScript) go to Crawl4AI.
 */
export async function tregFetchPages(workspaceId: string, urls: string[], opts: { fallback?: boolean } = {}): Promise<Map<string, WebPage | null>> {
  const out = new Map<string, WebPage | null>();
  const retry: string[] = [];
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    try {
      const r = await tregCall<Obj>("tinyfish.web.fetch", { workspaceId, purpose: "web_fetch", body: { urls: batch, format: "markdown", links: true }, maxCostUsd: 0.001, noWaterfall: true });
      const results = (isObj(r.data) && Array.isArray(r.data.results) ? r.data.results : []) as Obj[];
      const errors = (isObj(r.data) && Array.isArray(r.data.errors) ? r.data.errors : []) as Obj[];
      for (const u of batch) {
        const hit = results.find((x) => str(x.url) === u);
        const err = errors.find((x) => str(x.url) === u);
        if (hit) out.set(u, pageOf(hit, u));
        else if (err && (err.status === 404 || err.status === 410 || err.error === "page_not_found")) out.set(u, null);
        else retry.push(u);
      }
    } catch { retry.push(...batch); }
  }
  for (const u of retry) {
    if (!opts.fallback) { out.set(u, null); continue; }
    try {
      const r = await tregCall<Obj>("crawl4ai.web.scrape", { workspaceId, purpose: "web_fetch", body: { url: u, format: "md" }, maxCostUsd: 0.001, noWaterfall: true });
      out.set(u, findPage(r.data, u));
    } catch { out.set(u, null); }
  }
  return out;
}

export interface NewsItem { title: string; url: string; publishedAt: string | null }

/** Recent news articles for a query (Exa news index), newest material since `sinceIso`. */
export async function tregNews(workspaceId: string, query: string, sinceIso: string, numResults = 10): Promise<NewsItem[]> {
  const r = await tregCall<Obj>("exa.web.search.news", {
    workspaceId, purpose: "news_search", maxCostUsd: 0.012, noWaterfall: true,
    body: { query, category: "news", numResults: Math.min(10, numResults), startPublishedDate: sinceIso.slice(0, 10) },
  });
  const find = (d: unknown, depth = 0): Obj[] => {
    if (depth > 3 || !isObj(d)) return [];
    if (Array.isArray(d.results)) return d.results.filter(isObj);
    for (const v of Object.values(d)) { const f = find(v, depth + 1); if (f.length) return f; }
    return [];
  };
  return find(r.data).map((x) => ({ title: str(x.title) ?? "", url: str(x.url) ?? "", publishedAt: str(x.publishedDate) ?? str(x.published_date) }))
    .filter((x) => x.title && x.url);
}
