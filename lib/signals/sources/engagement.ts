import { fetchPostEngagers, fetchRecentPosts, parseEntityUrl, searchPostsByKeyword, engagerKey, type Engager, type EntityRef, type PostRef } from "@/lib/linkedin/engagers";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import { tregEnabled } from "@/lib/treg/client";
import { tregPostEngagers, tregRecentPosts, tregSearchPosts } from "@/lib/treg/linkedin";
import type { SignalType } from "@/lib/signals/types";
import { cachedRead } from "@/lib/signals/read-cache";

/** Posts older than this carry little intent; skip them. */
const MAX_POST_AGE_DAYS = 21;
/**
 * Engager lists are paid per read and mostly repeat, so a post is read at most three times:
 * when first seen, then once it is a day old, then at three days (when its reactions have
 * mostly come in). A re-read is skipped when the post's reaction count hasn't grown.
 */
export const READ_MILESTONES_HOURS = [0, 24, 72];
const MIN_GROWTH_RATIO = 1.15;
const MIN_GROWTH_ABS = 5;

/** What we remember about a post between runs (older cursors stored only the first-seen time). */
export interface PostState { first: string; reads: number; last: string; reactions?: number | null }

export function postState(raw: unknown): PostState | null {
  if (typeof raw === "string") return { first: raw, reads: 1, last: raw };
  if (raw && typeof raw === "object" && "first" in raw) return raw as PostState;
  return null;
}

/** Whether to buy this post's engagers now. */
export function shouldReadEngagers(state: PostState | null, reactions: number | null | undefined, now = Date.now()): boolean {
  if (!state) return true;
  if (state.reads >= READ_MILESTONES_HOURS.length) return false;
  const due = Date.parse(state.first) + READ_MILESTONES_HOURS[state.reads] * 3_600_000;
  if (now < due) return false;
  if (typeof reactions === "number" && typeof state.reactions === "number") {
    const grown = reactions >= state.reactions * MIN_GROWTH_RATIO && reactions - state.reactions >= MIN_GROWTH_ABS;
    if (!grown) return false;
  }
  return true;
}

function ageDays(iso: string | null): number {
  return iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : 0;
}

export function entityLabel(url: string): string {
  const ref = parseEntityUrl(url);
  if (!ref) return url;
  const raw = ref.kind === "company" ? ref.universalName : ref.publicId;
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Where post and engagement data comes from: treg when configured, else the agent's LinkedIn session. */
interface PostData {
  posts(entity: EntityRef, count: number): Promise<PostRef[]>;
  search(keyword: string, count: number): Promise<PostRef[]>;
  engagers(post: PostRef, opts: { reactions?: number }): Promise<Engager[]>;
}

const entityKey = (e: EntityRef) => (e.kind === "company" ? `company:${e.universalName}` : `profile:${e.publicId}`).toLowerCase();

/** Reads are public, so they are shared across agents for a few hours (lib/signals/read-cache.ts). */
function shared(provider: string, data: PostData): PostData {
  return {
    posts: (e, n) => cachedRead(`${provider}:posts:${entityKey(e)}:${n}`, () => data.posts(e, n)),
    search: (k, n) => cachedRead(`${provider}:search:${k.toLowerCase()}:${n}`, () => data.search(k, n)),
    engagers: (p, o) => cachedRead(`${provider}:engagers:${p.activityUrn}:${o.reactions ?? 0}`, () => data.engagers(p, o)),
  };
}

function postData(ctx: SourceRunContext): PostData {
  if (tregEnabled()) {
    return shared("treg", {
      posts: (e, n) => tregRecentPosts(ctx.workspaceId, e, n),
      search: (k, n) => tregSearchPosts(ctx.workspaceId, k, n),
      engagers: (p, o) => tregPostEngagers(ctx.workspaceId, p, o),
    });
  }
  const voyager = ctx.voyager;
  if (!voyager) throw new Error("This source needs an authenticated LinkedIn account on the agent");
  return shared("li", {
    posts: (e, n) => fetchRecentPosts(voyager, e, n),
    search: (k, n) => searchPostsByKeyword(voyager, k, n),
    engagers: (p, o) => fetchPostEngagers(voyager, p.activityUrn, o),
  });
}

async function harvestPost(ctx: SourceRunContext, data: PostData, post: PostRef, type: SignalType, what: string, excludeEmployeesOf?: string[]) {
  const seen = (ctx.cursor.posts ?? {}) as Record<string, unknown>;
  if (ageDays(post.postedAt) > MAX_POST_AGE_DAYS) return;
  const state = postState(seen[post.activityUrn]);
  if (!shouldReadEngagers(state, post.reactions)) return;
  const nowIso = new Date().toISOString();
  seen[post.activityUrn] = { first: state?.first ?? nowIso, reads: (state?.reads ?? 0) + 1, last: nowIso, reactions: post.reactions ?? state?.reactions ?? null } satisfies PostState;
  // Forget posts too old to matter, so the cursor stays small.
  for (const [urn, v] of Object.entries(seen)) { const st = postState(v); if (st && ageDays(st.first) > MAX_POST_AGE_DAYS + 7) delete seen[urn]; }
  ctx.cursor.posts = seen;

  // Low-yield items ask for fewer engagers (the scheduler sets lean).
  const engagers = await data.engagers(post, { reactions: ctx.lean ? Math.min(20, ctx.config.max_engagers_per_post) : ctx.config.max_engagers_per_post });
  const excerpt = post.text ? `"${post.text.slice(0, 160)}${post.text.length > 160 ? "…" : ""}"` : null;
  for (const e of engagers) {
    if (ctx.isFull()) return;
    const verb = e.kind === "comment" ? "Commented on" : "Reacted to";
    ctx.emitLead(
      { name: e.name, firstName: e.firstName, lastName: e.lastName, headline: e.headline, profileUrl: e.profileUrl, memberUrn: e.memberUrn, profileImageUrl: e.imageUrl },
      {
        type,
        title: `${verb} ${what}`,
        snippet: e.commentText ?? excerpt,
        sourceUrl: post.url,
        dedupeKey: `${type}:${post.activityUrn}:${engagerKey(e)}`,
        occurredAt: post.postedAt,
        metadata: { post_urn: post.activityUrn, post_excerpt: post.text.slice(0, 300), engagement: e.kind, reaction: e.reactionType },
      },
      { excludeEmployeesOf },
    );
  }
}

/** competitor_engagement / influencer_engagement / own_content_engagement share one runner. */
export function engagementRunner(type: SignalType): SourceRunner {
  return async (ctx) => {
    const data = postData(ctx);
    for (const url of ctx.config.urls) {
      const entity = parseEntityUrl(url);
      if (!entity) continue;
      const posts = await data.posts(entity, ctx.lean ? 1 : ctx.config.posts_per_entity);
      const what = type === "own_content_engagement" ? "your post" : `${entityLabel(url)}'s post`;
      // A competitor's own staff like its posts; they are not prospects.
      const staff = type === "competitor_engagement" ? [entityLabel(url)] : undefined;
      for (const post of posts) { if (ctx.isFull()) return; await harvestPost(ctx, data, post, type, what, staff); }
    }
  };
}

export const keywordRunner: SourceRunner = async (ctx) => {
  const data = postData(ctx);
  const keywords = ctx.config.keywords.length ? ctx.config.keywords : (ctx.icp?.keywords ?? []).slice(0, 5);
  for (const keyword of keywords) {
    const posts = await data.search(keyword, ctx.lean ? 1 : ctx.config.posts_per_entity);
    for (const post of posts) { if (ctx.isFull()) return; await harvestPost(ctx, data, post, "keyword_engagement", `a post about "${keyword}"`); }
  }
};
