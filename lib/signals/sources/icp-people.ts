import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import type { LeadCandidate } from "@/lib/signals/leads";
import { prefilterLead } from "@/lib/signals/leads";
import { tregEnabled } from "@/lib/treg/client";
import { parseEntityUrl } from "@/lib/linkedin/engagers";
import { tregProfile, tregRecentPosts } from "@/lib/treg/linkedin";
import { tregPeopleSearch } from "@/lib/treg/people";

/**
 * People signals read from the people database for the agent's ICP:
 *  - top_active: people who post on LinkedIn at least weekly (the top few percent of members)
 *  - new_decision_maker: decision-makers who started their current role in the last 90 days
 * Each run checks a small page of ICP matches (paid lookups), paging on with a stored token.
 */

/** Posts in the last 30 days that put someone in the most active few percent on LinkedIn. */
export const ACTIVE_POSTS_30D = 4;
export const NEW_ROLE_DAYS = 90;
const CHECKS_PER_RUN = 15;
const DAY = 86_400_000;

export const DECISION_MAKER_RE = /\b(chief|ceo|cto|cfo|coo|cmo|cro|cpo|ciso|founder|co-founder|owner|president|vp|vice[- ]president|head of|director|partner|general manager|managing director)\b/i;

/** Posts dated within the last `days` days. */
export function postsWithin(posts: Array<{ postedAt: string | null }>, days: number, now = Date.now()): number {
  return posts.filter((p) => p.postedAt && now - Date.parse(p.postedAt) <= days * DAY).length;
}

/** "2026-08-01" style start dates within the last `days` days (month precision is fine). */
export function startedWithin(started: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!started) return false;
  const t = Date.parse(started.length === 7 ? `${started}-01` : started);
  return !Number.isNaN(t) && t <= now && now - t <= days * DAY;
}

function needTreg(ctx: SourceRunContext) {
  if (!tregEnabled()) throw new Error("This signal needs the people database (Treg) to be configured");
  if (!ctx.icp) throw new Error("Set up the agent's targeting first: this signal searches its job titles, industries and sizes");
}

/** The next page of ICP people that pass the cheap filters, without the ones seen before. */
async function nextPeople(ctx: SourceRunContext, key: string, keep: (p: LeadCandidate) => boolean): Promise<LeadCandidate[]> {
  const r = await tregPeopleSearch(ctx.workspaceId, ctx.icp!, 50, (ctx.cursor[`${key}_token`] as string | undefined) ?? null);
  ctx.cursor[`${key}_token`] = r.token;
  return r.leads.filter((p) => p.profileUrl && keep(p) && prefilterLead(p, { icp: ctx.icp }).ok).slice(0, CHECKS_PER_RUN);
}

export const topActiveRunner: SourceRunner = async (ctx) => {
  needTreg(ctx);
  for (const p of await nextPeople(ctx, "active", () => true)) {
    if (ctx.isFull()) break;
    const entity = parseEntityUrl(p.profileUrl!);
    if (!entity) continue;
    const posts = await tregRecentPosts(ctx.workspaceId, entity, 10).catch(() => []);
    const n = postsWithin(posts, 30);
    if (n < ACTIVE_POSTS_30D) continue;
    ctx.emitLead(p, {
      type: "top_active", title: "Top 5% most active in your ICP (LinkedIn)", snippet: `${n} posts in the last 30 days`, sourceUrl: posts[0]?.url ?? p.profileUrl,
      // Once a month per person: activity is re-judged, not re-counted daily.
      dedupeKey: `top_active:${ctx.agent.id}:${p.profileUrl}:${new Date().toISOString().slice(0, 7)}`, metadata: { posts_30d: n },
    });
  }
};

export const newDecisionMakerRunner: SourceRunner = async (ctx) => {
  needTreg(ctx);
  for (const p of await nextPeople(ctx, "dm", (c) => DECISION_MAKER_RE.test(`${c.title ?? ""} ${c.headline ?? ""}`))) {
    if (ctx.isFull()) break;
    const profile = await tregProfile(ctx.workspaceId, p.profileUrl!).catch(() => null);
    const started = profile?.current?.started;
    if (!startedWithin(started, NEW_ROLE_DAYS)) continue;
    const role = profile?.current?.title ?? p.title ?? "a new role";
    const at = profile?.current?.company ?? p.company;
    const when = new Date(Date.parse(started!.length === 7 ? `${started}-01` : started!)).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    ctx.emitLead({ ...p, title: profile?.current?.title ?? p.title, company: at ?? p.company }, {
      type: "new_decision_maker", title: `New decision-maker: ${role}${at ? ` at ${at}` : ""}`, snippet: `Started in ${when}`, sourceUrl: p.profileUrl,
      dedupeKey: `new_dm:${p.profileUrl}:${(at ?? "").toLowerCase()}`, occurredAt: new Date(Date.parse(started!.length === 7 ? `${started}-01` : started!)).toISOString(),
      metadata: { started, role, company: at },
    });
  }
};
