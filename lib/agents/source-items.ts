import type Database from "better-sqlite3";
import { entityLabel } from "@/lib/signals/sources/engagement";

/**
 * The individual things a lead source tracks (a competitor page, a topic, a job board, a list),
 * each with how many leads it found, for the agent's Sources tab. Counts come from the leads'
 * signal titles ("Reacted to a post about \"outbound\"", "Commented on Lemlist's post"), so they
 * cover every lead the item ever produced without extra bookkeeping.
 */

export interface SourceItem { key: string; label: string; sub: string; leads: number; volume: "high" | "low" }
interface SourceLike { source_type: string; config_json: string; agent_id: string }
interface Config { keywords?: string[]; urls?: string[]; boards?: Array<{ ats: string; slug: string; company?: string }>; list_ids?: string[] }

/** An item that found at least this many leads is "High volume". */
export const HIGH_VOLUME_LEADS = 10;

const ENGAGEMENT_SUB: Record<string, string> = {
  competitor_engagement: "Company competitor profile", influencer_engagement: "Expert profile", own_content_engagement: "Your profile",
};

function config(s: SourceLike): Config {
  try { return JSON.parse(s.config_json || "{}") as Config; } catch { return {}; }
}

/** The item keys a source's config holds: keywords, page URLs, job boards ("ats:slug") or list ids. */
export function itemKeys(s: SourceLike): string[] {
  const c = config(s);
  if (c.keywords?.length) return c.keywords;
  if (c.urls?.length) return c.urls;
  if (c.boards?.length) return c.boards.map((b) => `${b.ats}:${b.slug}`);
  if (c.list_ids?.length) return c.list_ids;
  return [];
}

/** The source's config with only `key` kept (Launch now on one item) or with `key` removed (Remove signal). */
export function configWithItems(s: SourceLike, keep: (key: string) => boolean): Config {
  const c = config(s);
  const out: Config = { ...c };
  if (c.keywords?.length) out.keywords = c.keywords.filter(keep);
  else if (c.urls?.length) out.urls = c.urls.filter(keep);
  else if (c.boards?.length) out.boards = c.boards.filter((b) => keep(`${b.ats}:${b.slug}`));
  else if (c.list_ids?.length) out.list_ids = c.list_ids.filter(keep);
  return out;
}

export function sourceItems(db: Database.Database, s: SourceLike): SourceItem[] {
  const c = config(s);
  const titles = db.prepare("SELECT title, COUNT(DISTINCT target_id) n FROM signals WHERE agent_id = ? AND source = ? AND target_id IS NOT NULL GROUP BY title")
    .all(s.agent_id, `agent:${s.source_type}`) as Array<{ title: string; n: number }>;
  const count = (match: (title: string) => boolean) => titles.filter((t) => match(t.title)).reduce((n, t) => n + t.n, 0);
  const item = (key: string, label: string, sub: string, leads: number): SourceItem => ({ key, label, sub, leads, volume: leads >= HIGH_VOLUME_LEADS ? "high" : "low" });

  if (c.keywords?.length) {
    return c.keywords.map((k) => item(k, k, "Engagement & Interest", count((t) => t.toLowerCase().includes(`"${k.toLowerCase()}"`))));
  }
  if (c.urls?.length) {
    return c.urls.map((u) => {
      const name = entityLabel(u);
      return item(u, name, ENGAGEMENT_SUB[s.source_type] ?? (/\/in\//.test(u) ? "LinkedIn profile" : "Company page"),
        count((t) => t.toLowerCase().includes(`${name.toLowerCase()}'s post`)));
    });
  }
  if (c.boards?.length) {
    // Hiring signals don't name the board: the source's total is shared out evenly.
    const total = count(() => true);
    return c.boards.map((b) => item(`${b.ats}:${b.slug}`, b.company || b.slug, `${b.ats} job board`, Math.round(total / c.boards!.length)));
  }
  if (c.list_ids?.length) {
    return c.list_ids.map((id) => {
      const l = db.prepare("SELECT name, (SELECT COUNT(*) FROM list_targets lt WHERE lt.list_id = lists.id) n FROM lists WHERE id = ?").get(id) as { name: string; n: number } | undefined;
      return item(id, l?.name ?? "Deleted list", "Saved list", l?.n ?? 0);
    });
  }
  return [];
}
