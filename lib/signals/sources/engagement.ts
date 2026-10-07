import { fetchPostEngagers, fetchRecentPosts, parseEntityUrl, searchPostsByKeyword, engagerKey, type PostRef } from "@/lib/linkedin/engagers";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
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

async function harvestPost(ctx: SourceRunContext, post: PostRef, type: SignalType, what: string) {
  const seen = (ctx.cursor.posts ?? {}) as Record<string, string>;
  const firstSeen = seen[post.activityUrn];
  if (firstSeen && ageDays(firstSeen) > REVISIT_DAYS) return;
  if (ageDays(post.postedAt) > MAX_POST_AGE_DAYS) return;
  seen[post.activityUrn] = firstSeen ?? new Date().toISOString();
  ctx.cursor.posts = seen;

  const engagers = await fetchPostEngagers(ctx.voyager!, post.activityUrn, { reactions: ctx.config.max_engagers_per_post, comments: ctx.config.max_engagers_per_post });
  const excerpt = post.text ? `"${post.text.slice(0, 160)}${post.text.length > 160 ? "…" : ""}"` : null;
  for (const e of engagers) {
    const verb = e.kind === "comment" ? "Commented on" : "Reacted to";
    ctx.emitLead(
      { name: e.name, firstName: e.firstName, lastName: e.lastName, headline: e.headline, profileUrl: e.profileUrl, memberUrn: e.memberUrn },
      {
        type,
        title: `${verb} ${what}`,
        snippet: e.commentText ?? excerpt,
        sourceUrl: post.url,
        dedupeKey: `${type}:${post.activityUrn}:${engagerKey(e)}`,
        occurredAt: post.postedAt,
        metadata: { post_urn: post.activityUrn, post_excerpt: post.text.slice(0, 300), engagement: e.kind, reaction: e.reactionType },
      },
    );
  }
}

/** competitor_engagement / influencer_engagement / own_content_engagement share one runner. */
export function engagementRunner(type: SignalType): SourceRunner {
  return async (ctx) => {
    if (!ctx.voyager) throw new Error("This source needs an authenticated LinkedIn account on the agent");
    for (const url of ctx.config.urls) {
      const entity = parseEntityUrl(url);
      if (!entity) continue;
      const posts = await fetchRecentPosts(ctx.voyager, entity, ctx.config.posts_per_entity);
      const what = type === "own_content_engagement" ? "your post" : `${entityLabel(url)}'s post`;
      for (const post of posts) await harvestPost(ctx, post, type, what);
    }
  };
}

export const keywordRunner: SourceRunner = async (ctx) => {
  if (!ctx.voyager) throw new Error("This source needs an authenticated LinkedIn account on the agent");
  const keywords = ctx.config.keywords.length ? ctx.config.keywords : (ctx.icp?.keywords ?? []).slice(0, 5);
  for (const keyword of keywords) {
    const posts = await searchPostsByKeyword(ctx.voyager, keyword, ctx.config.posts_per_entity);
    for (const post of posts) await harvestPost(ctx, post, "keyword_engagement", `a post about "${keyword}"`);
  }
};
