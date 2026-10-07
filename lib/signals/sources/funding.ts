import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import type { SourceRunner } from "@/lib/signals/sources/types";

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

/** Reads funding news and keeps rounds at companies that match the ICP. */
export const fundingRunner: SourceRunner = async (ctx) => {
  const feeds = ctx.config.feeds.length ? ctx.config.feeds : DEFAULT_FEEDS;
  const items: FeedItem[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed, { headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" } });
      if (res.ok) items.push(...parseFeed(await res.text()));
    } catch { /* one bad feed must not stop the rest */ }
  }
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

  for (const r of result.rounds) {
    const item = fresh[r.index];
    if (!item || !r.fits_icp || !r.company.trim()) continue;
    ctx.emitForCompany({ name: r.company.trim() }, {
      type: "funding",
      title: `${r.company} raised ${[r.amount, r.round].filter(Boolean).join(" ") || "a new round"}`,
      snippet: r.reason,
      sourceUrl: item.link,
      dedupeKey: `funding:${item.link}`,
      occurredAt: item.pubDate,
      metadata: { round: r.round ?? null, amount: r.amount ?? null, headline: item.title },
    });
  }
};
