import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import { prefilterLead } from "@/lib/signals/leads";
import { tregEnabled } from "@/lib/treg/client";
import { tregPeopleAtCompany } from "@/lib/treg/people";
import { tregNews } from "@/lib/treg/web";

export interface FeedItem { title: string; link: string; description: string; pubDate: string | null }

const DEFAULT_FEEDS = ["https://techcrunch.com/category/venture/feed/"];
const MAX_AGE_DAYS = 7;

function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, "\"").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Minimal RSS/Atom item parser — enough for news feeds, no dependency. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const pick = (tag: string) => block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ?? "";
    const link = pick("link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const date = pick("pubDate") || pick("published") || pick("updated");
    items.push({ title: decode(pick("title")), link: decode(link), description: decode(pick("description") || pick("summary")).slice(0, 500), pubDate: date ? new Date(date).toISOString() : null });
  }
  return items.filter((i) => i.title && i.link);
}

const extractionSchema = z.object({
  rounds: z.array(z.object({
    index: z.number().int(),
    company: z.string().max(160),
    round: z.string().max(60).nullable().optional(),
    amount: z.string().max(60).nullable().optional(),
    fits_icp: z.boolean(),
    reason: z.string().max(300),
  })).max(60),
});

/** News queries per run (Exa, $0.007 each) and the funded companies we look for people at. */
const NEWS_QUERIES = 2;
const COMPANIES_PER_RUN = 5;
const PEOPLE_PER_COMPANY = 3;

/** "SaaS company raises funding round" style queries from the ICP's industries (or its offer). */
export function fundingQueries(icp: SourceRunContext["icp"], max = NEWS_QUERIES): string[] {
  const topics = (icp?.industries ?? []).filter(Boolean).slice(0, max);
  const geo = icp?.geographies?.[0] ? ` ${icp.geographies[0]}` : "";
  if (!topics.length) return [`startup raises Series A funding round${geo}`];
  return topics.map((t) => `${t} company raises funding round${geo}`);
}

/** Exa news through treg: funding announcements in the ICP's industries since the last run. */
async function newsItems(ctx: SourceRunContext): Promise<FeedItem[]> {
  if (!tregEnabled() || !ctx.icp) return [];
  const since = typeof ctx.cursor.news_since === "string" ? ctx.cursor.news_since : new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
  const out: FeedItem[] = [];
  for (const q of fundingQueries(ctx.icp, ctx.lean ? 1 : NEWS_QUERIES)) {
    const news = await tregNews(ctx.workspaceId, q, since).catch(() => []);
    out.push(...news.map((n) => ({ title: n.title, link: n.url, description: "", pubDate: n.publishedAt })));
  }
  ctx.cursor.news_since = new Date().toISOString();
  return out;
}

/** Reads funding news (feeds, and Exa news for the ICP) and keeps rounds at companies that match the ICP. */
export const fundingRunner: SourceRunner = async (ctx) => {
  const feeds = ctx.config.feeds.length ? ctx.config.feeds : DEFAULT_FEEDS;
  const items: FeedItem[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed, { headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" } });
      if (res.ok) items.push(...parseFeed(await res.text()));
    } catch { /* one bad feed must not stop the rest */ }
  }
  items.push(...await newsItems(ctx));
  const seen = (ctx.cursor.links ?? {}) as Record<string, 1>;
  const fresh = items.filter((i) => !seen[i.link] && (!i.pubDate || (Date.now() - Date.parse(i.pubDate)) / 86_400_000 <= MAX_AGE_DAYS)).slice(0, 40);
  if (!fresh.length) return;
  for (const i of fresh) seen[i.link] = 1;
  ctx.cursor.links = Object.fromEntries(Object.entries(seen).slice(-500));

  const result = await aiJson({
    workspaceId: ctx.workspaceId,
    purpose: "funding_extract",
    instructions: [
      "Each item in data.items is a news headline. Keep only items announcing that a specific company raised a funding round.",
      "For each, give the company name, round (e.g. Seed, Series A) and amount if stated.",
      "fits_icp: true only if the company plausibly belongs to the ideal customer profile in data.icp (industry, size, geography).",
    ],
    data: { icp: ctx.icp ? { industries: ctx.icp.industries, company_sizes: ctx.icp.company_sizes, geographies: ctx.icp.geographies, offer: ctx.icp.offer } : null, items: fresh.map((i, index) => ({ index, title: i.title, summary: i.description })) },
    outputShape: `{"rounds":[{"index":0,"company":"","round":"Series A","amount":"$10M","fits_icp":true,"reason":""}]}`,
    schema: extractionSchema,
  });

  let lookedUp = 0;
  for (const r of result.rounds) {
    const item = fresh[r.index];
    if (!item || !r.fits_icp || !r.company.trim()) continue;
    const company = r.company.trim();
    const title = `${company} raised ${[r.amount, r.round].filter(Boolean).join(" ") || "a new round"}`;
    const signal = { type: "funding" as const, title, snippet: r.reason, sourceUrl: item.link, occurredAt: item.pubDate, metadata: { round: r.round ?? null, amount: r.amount ?? null, headline: item.title } };
    ctx.emitForCompany({ name: company }, { ...signal, dedupeKey: `funding:${item.link}` });
    // A round matters through the people who can buy: find the ICP's roles at the company
    // (a handful of paid rows), so the signal becomes leads, not just a company note.
    if (!tregEnabled() || !ctx.icp || lookedUp >= COMPANIES_PER_RUN || ctx.isFull()) continue;
    lookedUp++;
    const people = await tregPeopleAtCompany(ctx.workspaceId, ctx.icp, { name: company }, ctx.lean ? 1 : PEOPLE_PER_COMPANY).catch(() => []);
    for (const p of people) {
      if (!p.profileUrl || !prefilterLead(p, { icp: ctx.icp }).ok) continue;
      ctx.emitLead(p, { ...signal, dedupeKey: `funding:${item.link}:${p.profileUrl}` });
    }
  }
};
