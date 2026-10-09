import { fetchPostEngagers, fetchRecentPosts, parseEntityUrl, searchPostsByKeyword, engagerKey, type Engager, type EntityRef, type PostRef } from "@/lib/linkedin/engagers";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import { tregEnabled } from "@/lib/treg/client";
import { tregPostEngagers, tregRecentPosts, tregSearchPosts } from "@/lib/treg/linkedin";
import type { SignalType } from "@/lib/signals/types";

/** Posts older than this carry little intent; skip them. */
const MAX_POST_AGE_DAYS = 21;
/** A post keeps collecting engagement for a few days; re-read it until then. */
const REVISIT_DAYS = 4;

function ageDays(iso: string | null): number {
  return iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : 0;
}

function entityLabel(url: string): string {
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

function postData(ctx: SourceRunContext): PostData {
  if (tregEnabled()) {
    return {
      posts: (e, n) => tregRecentPosts(ctx.workspaceId, e, n),
      search: (k, n) => tregSearchPosts(ctx.workspaceId, k, n),
      engagers: (p, o) => tregPostEngagers(ctx.workspaceId, p, o),
    };
  }
  const voyager = ctx.voyager;
  if (!voyager) throw new Error("This source needs an authenticated LinkedIn account on the agent");
  return {
    posts: (e, n) => fetchRecentPosts(voyager, e, n),
    search: (k, n) => searchPostsByKeyword(voyager, k, n),
    engagers: (p, o) => fetchPostEngagers(voyager, p.activityUrn, o),
  };
}

async function harvestPost(ctx: SourceRunContext, data: PostData, post: PostRef, type: SignalType, what: string, excludeEmployeesOf?: string[]) {
  const seen = (ctx.cursor.posts ?? {}) as Record<string, string>;
  const firstSeen = seen[post.activityUrn];
  if (firstSeen && ageDays(firstSeen) > REVISIT_DAYS) return;
  if (ageDays(post.postedAt) > MAX_POST_AGE_DAYS) return;
  seen[post.activityUrn] = firstSeen ?? new Date().toISOString();
  ctx.cursor.posts = seen;

  const engagers = await data.engagers(post, { reactions: ctx.config.max_engagers_per_post });
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
      const posts = await data.posts(entity, ctx.config.posts_per_entity);
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
    const posts = await data.search(keyword, ctx.config.posts_per_entity);
    for (const post of posts) { if (ctx.isFull()) return; await harvestPost(ctx, data, post, "keyword_engagement", `a post about "${keyword}"`); }
  }
};
