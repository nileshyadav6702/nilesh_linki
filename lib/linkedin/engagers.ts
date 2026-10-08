/**
 * Post + engager discovery over Voyager. Parsers are pure and accept both response
 * styles LinkedIn serves — nested JSON and the normalized {data, included} form — because
 * which one comes back has varied by endpoint and over time. Endpoints follow the ones
 * already proven in profile-scrape.ts (memberShareFeed) and the long-stable
 * companyFeedByUniversalName / voyagerSocialDashReactions / feed/comments routes.
 */
import { linkedInImageUrl } from "@/lib/linkedin/images";

type BudgetKind = "voyager_read" | "search" | "profile_view";
export interface VoyagerLike {
  get(path: string, opts?: { normalized?: boolean; kind?: BudgetKind }): Promise<unknown | null>;
  /** Load a LinkedIn page and return the bodies of matching responses (see VoyagerClient). */
  capturePage?(url: string, opts: { match: RegExp; scrolls?: number; kind?: BudgetKind }): Promise<string[]>;
}

export interface PostRef { activityUrn: string; text: string; postedAt: string | null; url: string }

export interface Engager {
  name: string;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  profileUrl: string | null;
  memberUrn: string | null;
  imageUrl: string | null;
  kind: "reaction" | "comment";
  reactionType: string | null;
  commentText: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (isObj(v) && typeof v.text === "string") return v.text;
  if (isObj(v) && isObj(v.text) && typeof (v.text as Obj).text === "string") return (v.text as Obj).text as string;
  return null;
}

/** Every object in a response, depth-first (elements, included, nested). */
export function walk(root: unknown, visit: (o: Obj) => void, depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(root)) { for (const x of root) walk(x, visit, depth + 1); return; }
  if (!isObj(root)) return;
  visit(root);
  for (const v of Object.values(root)) if (v && typeof v === "object") walk(v, visit, depth + 1);
}

function indexByUrn(root: unknown): Map<string, Obj> {
  const map = new Map<string, Obj>();
  walk(root, (o) => { if (typeof o.entityUrn === "string") map.set(o.entityUrn, o); });
  return map;
}

const SHIFT_22 = 4194304;
export function timeFromActivityUrn(urn: string): string | null {
  const m = urn.match(/(\d{18,})/);
  if (!m) return null;
  const ms = Math.floor(Number(m[1]) / SHIFT_22);
  return ms > 1_000_000_000_000 ? new Date(ms).toISOString() : null;
}

export function activityIdOf(urn: string): string | null {
  return urn.match(/urn:li:(?:activity|ugcPost|share):(\d+)/)?.[1] ?? null;
}

export function parseFeedUpdates(json: unknown): PostRef[] {
  const out = new Map<string, PostRef>();
  walk(json, (o) => {
    const type = String(o.$type ?? "");
    const meta = o.updateMetadata as Obj | undefined;
    const urn = (meta && typeof meta.urn === "string" ? meta.urn : null) ?? (type.endsWith("UpdateV2") && typeof o.entityUrn === "string" ? o.entityUrn : null);
    if (!urn || !/urn:li:activity:\d+/.test(urn)) return;
    const activityUrn = urn.match(/urn:li:activity:\d+/)![0];
    const commentary = o.commentary as Obj | undefined;
    const text = commentary ? textOf(commentary.text) ?? textOf(commentary) : null;
    if (out.has(activityUrn) && !text) return;
    out.set(activityUrn, { activityUrn, text: (text ?? "").slice(0, 600), postedAt: timeFromActivityUrn(activityUrn), url: `https://www.linkedin.com/feed/update/${activityUrn}/` });
  });
  return [...out.values()].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

function profileFromMini(mini: Obj): Pick<Engager, "name" | "firstName" | "lastName" | "headline" | "profileUrl" | "memberUrn" | "imageUrl"> | null {
  const first = typeof mini.firstName === "string" ? mini.firstName : null;
  const last = typeof mini.lastName === "string" ? mini.lastName : null;
  const name = [first, last].filter(Boolean).join(" ").trim();
  if (!name) return null;
  const pid = typeof mini.publicIdentifier === "string" ? mini.publicIdentifier : null;
  const urn = typeof mini.objectUrn === "string" ? mini.objectUrn : typeof mini.entityUrn === "string" ? mini.entityUrn : null;
  return { name, firstName: first, lastName: last, headline: typeof mini.occupation === "string" ? mini.occupation : typeof mini.headline === "string" ? mini.headline : null, profileUrl: pid ? `https://www.linkedin.com/in/${pid}` : null, memberUrn: urn, imageUrl: linkedInImageUrl(mini.picture ?? mini.profilePicture, 100) };
}

function profileFromLockup(lockup: Obj, actorUrn: string | null): Pick<Engager, "name" | "firstName" | "lastName" | "headline" | "profileUrl" | "memberUrn" | "imageUrl"> | null {
  const name = textOf(lockup.title)?.trim();
  if (!name) return null;
  const nav = typeof lockup.navigationUrl === "string" ? lockup.navigationUrl.split("?")[0] : null;
  return { name, ...splitName(name), headline: textOf(lockup.subtitle) ?? textOf(lockup.caption), profileUrl: nav && nav.includes("/in/") ? nav : null, memberUrn: actorUrn, imageUrl: linkedInImageUrl(lockup.image, 100) };
}

/** Only people: company pages and showcase pages that react are not leads. */
function isPerson(e: { profileUrl: string | null; memberUrn: string | null }): boolean {
  if (e.profileUrl) return e.profileUrl.includes("/in/");
  return !!e.memberUrn && /(fsd_profile|fs_miniProfile|member):/.test(e.memberUrn);
}

export function parseReactions(json: unknown): Engager[] {
  const byUrn = indexByUrn(json);
  const out: Engager[] = [];
  walk(json, (o) => {
    if (!("reactionType" in o)) return;
    const reactionType = typeof o.reactionType === "string" ? o.reactionType : null;
    const actorUrn = typeof o.actorUrn === "string" ? o.actorUrn : typeof o["*actor"] === "string" ? o["*actor"] as string : null;
    let p: ReturnType<typeof profileFromLockup> = null;
    if (isObj(o.reactorLockup)) p = profileFromLockup(o.reactorLockup, actorUrn);
    if (!p && isObj(o.actor)) {
      const member = (o.actor as Obj)["com.linkedin.voyager.feed.MemberActor"] as Obj | undefined;
      const mini = member && (isObj(member.miniProfile) ? member.miniProfile : byUrn.get(String(member["*miniProfile"] ?? member.miniProfile ?? "")));
      if (isObj(mini)) p = profileFromMini(mini);
    }
    if (!p && actorUrn && byUrn.has(actorUrn)) p = profileFromMini(byUrn.get(actorUrn)!);
    if (p && isPerson(p)) out.push({ ...p, kind: "reaction", reactionType, commentText: null });
  });
  return dedupeEngagers(out);
}

export function parseComments(json: unknown): Engager[] {
  const byUrn = indexByUrn(json);
  const out: Engager[] = [];
  walk(json, (o) => {
    const hasText = "commentV2" in o || "commentary" in o || ("comment" in o && "commenter" in o);
    if (!hasText || !("commenter" in o || "*commenter" in o || "commenterProfileId" in o)) return;
    const text = textOf(o.commentV2) ?? textOf(o.commentary) ?? (isObj(o.comment) ? textOf((o.comment as Obj).values && Array.isArray((o.comment as Obj).values) ? ((o.comment as Obj).values as Obj[])[0]?.value : null) : null);
    let p: ReturnType<typeof profileFromLockup> = null;
    const commenter = o.commenter;
    if (isObj(commenter)) {
      const member = commenter["com.linkedin.voyager.feed.MemberActor"] as Obj | undefined;
      if (member) {
        const mini = isObj(member.miniProfile) ? member.miniProfile : byUrn.get(String(member["*miniProfile"] ?? ""));
        if (isObj(mini)) p = profileFromMini(mini);
      }
      if (!p && (commenter.title || commenter.navigationUrl)) {
        const actor = isObj(commenter.actor) ? commenter.actor : null;
        const urn = actor && typeof actor["*profileUrn"] === "string" ? actor["*profileUrn"] as string : typeof commenter.commenterProfileId === "string" ? `urn:li:fsd_profile:${commenter.commenterProfileId}` : null;
        p = profileFromLockup(commenter, urn);
      }
    } else if (typeof o["*commenter"] === "string" && byUrn.has(o["*commenter"] as string)) {
      p = profileFromMini(byUrn.get(o["*commenter"] as string)!);
    }
    if (p && isPerson(p)) out.push({ ...p, kind: "comment", reactionType: null, commentText: text ? text.slice(0, 500) : null });
  });
  return dedupeEngagers(out);
}

export function engagerKey(e: Pick<Engager, "memberUrn" | "profileUrl" | "name">): string {
  if (e.memberUrn) return e.memberUrn.replace(/^urn:li:(fsd_profile|fs_miniProfile|member):/, "");
  if (e.profileUrl) return e.profileUrl.toLowerCase().replace(/\/$/, "");
  return e.name.toLowerCase();
}

/** One entry per person; a comment wins over a reaction (it carries text). */
export function dedupeEngagers(list: Engager[]): Engager[] {
  const map = new Map<string, Engager>();
  for (const e of list) {
    const k = engagerKey(e);
    const prev = map.get(k);
    if (!prev || (prev.kind === "reaction" && e.kind === "comment")) map.set(k, e);
  }
  return [...map.values()];
}

export type EntityRef = { kind: "company"; universalName: string } | { kind: "profile"; publicId: string };

export function parseEntityUrl(url: string): EntityRef | null {
  const company = url.match(/linkedin\.com\/(?:company|showcase|school)\/([^/?#]+)/i);
  if (company) return { kind: "company", universalName: decodeURIComponent(company[1]) };
  const profile = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (profile) return { kind: "profile", publicId: decodeURIComponent(profile[1]) };
  return null;
}

export async function fetchRecentPosts(client: VoyagerLike, entity: EntityRef, count = 5): Promise<PostRef[]> {
  const path = entity.kind === "company"
    ? `/voyager/api/feed/updates?companyUniversalName=${encodeURIComponent(entity.universalName)}&q=companyFeedByUniversalName&moduleKey=member-share&count=${count}&start=0`
    : `/voyager/api/feed/updates?profileId=${encodeURIComponent(entity.publicId)}&q=memberShareFeed&moduleKey=member-share&count=${count}&start=0`;
  try {
    const json = await client.get(path, { normalized: true });
    const posts = json ? parseFeedUpdates(json).slice(0, count) : [];
    if (posts.length || !client.capturePage) return posts;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (!client.capturePage || name === "VoyagerBlockedError" || name === "VoyagerBudgetExceeded") throw err;
  }
  const pageUrl = entity.kind === "company"
    ? `https://www.linkedin.com/company/${encodeURIComponent(entity.universalName)}/posts/?feedView=all`
    : `https://www.linkedin.com/in/${encodeURIComponent(entity.publicId)}/recent-activity/all/`;
  const bodies = await client.capturePage(pageUrl, { match: /linkedin\.com/, scrolls: 1 });
  return activityUrnsIn(bodies).slice(0, count).map((urn) => ({ activityUrn: urn, text: "", postedAt: timeFromActivityUrn(urn), url: `https://www.linkedin.com/feed/update/${urn}/` }));
}

/**
 * People who reacted to a post. (LinkedIn retired the feed/comments endpoint in 2026 — it
 * answers 400 — so commenters are no longer fetched separately; most commenters also react.)
 */
export async function fetchPostEngagers(client: VoyagerLike, activityUrn: string, opts: { reactions?: number } = {}): Promise<Engager[]> {
  const id = activityIdOf(activityUrn);
  if (!id) return [];
  const reactions = await client.get(`/voyager/api/voyagerSocialDashReactions?decorationId=com.linkedin.voyager.dash.deco.social.ReactionsByTypeWithProfileActions-13&count=${opts.reactions ?? 40}&q=reactionType&start=0&threadUrn=${encodeURIComponent(`urn:li:activity:${id}`)}`);
  return reactions ? dedupeEngagers(parseReactions(reactions)) : [];
}

/** Distinct post URNs in raw response text, in order of appearance. */
export function activityUrnsIn(bodies: string[]): string[] {
  const seen = new Set<string>();
  for (const b of bodies) for (const m of b.match(/urn:li:activity:\d{15,}/g) ?? []) seen.add(m);
  return [...seen];
}

/**
 * Recent posts matching a keyword. LinkedIn now renders content search server-side: the
 * search/dash/clusters API returns result wrappers without the posts, so the search page is
 * loaded and post URNs are read from its own response stream (first page + one scroll).
 * Past-week posts by relevance, not newest first: brand-new posts have no reactions yet.
 */
export async function searchPostsByKeyword(client: VoyagerLike, keyword: string, count = 5): Promise<PostRef[]> {
  const q = encodeURIComponent(keyword.replace(/[(),:]/g, " ").trim());
  let urns: string[] = [];
  if (client.capturePage) {
    const bodies = await client.capturePage(`https://www.linkedin.com/search/results/content/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER&datePosted=%22past-week%22`,
      { match: /\/search\/results\/content\/|contentSearchResults/, scrolls: 1, kind: "search" });
    urns = activityUrnsIn(bodies);
  } else {
    // Clients without a browser page (tests, API-only providers) try the JSON endpoint.
    const json = await client.get(`/voyager/api/search/dash/clusters?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-175&origin=GLOBAL_SEARCH_HEADER&q=all&query=(keywords:${q},flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:List(CONTENT),sortBy:List(date_posted)))&start=0&count=${count}`, { normalized: true, kind: "search" });
    if (!json) return [];
    const posts = parseFeedUpdates(json);
    if (posts.length) return posts.slice(0, count);
    urns = activityUrnsIn([JSON.stringify(json)]);
  }
  return urns.slice(0, count).map((u) => ({ activityUrn: u, text: "", postedAt: timeFromActivityUrn(u), url: `https://www.linkedin.com/feed/update/${u}/` }));
}
