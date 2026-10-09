import { tregCall } from "@/lib/treg/client";
import { timeFromActivityUrn, type EntityRef, type Engager, type PostRef } from "@/lib/linkedin/engagers";

/**
 * LinkedIn data through treg, in the shapes the browser-based detectors already use (PostRef,
 * Engager), so the signal runners do not care where the data came from.
 *
 * Routed endpoints (treg.linkedin.*) normalise their output; vendor endpoints relay the vendor's
 * own body, so rows are read defensively. Endpoint choice and prices (Oct 2026 catalog):
 *  - treg.linkedin.user.profile    $0.0012/hit  { output: full_name, headline, about, location… }
 *  - treg.linkedin.user.posts      $0.0015/hit  { output: { posts: vendor rows } }
 *  - anyapi.linkedin.company_posts_thin $0.002  company page posts
 *  - anyapi.linkedin.search.posts.full  $0.0143 keyword post search
 *  - fetchinio.linkedin.post.engagement $0.003  reactions[].actor + comments[].author (100 each)
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const pick = (o: Obj, keys: string[]): string | null => { for (const k of keys) { const v = str(o[k]); if (v) return v; } return null; };

/** Public profile URL from what we store: drops Sales Navigator suffixes (",NAME_SEARCH,8f6m") and query strings. */
export function profileUrlFor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/linkedin\.com\/in\/([^/?#,\s]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1])}` : null;
}

export function entityUrl(e: EntityRef): string {
  return e.kind === "company" ? `https://www.linkedin.com/company/${e.universalName}/` : `https://www.linkedin.com/in/${e.publicId}/`;
}

/** The activity URN of a vendor post row: an explicit URN, "activity-<id>" in its URL, or a long numeric id. */
function activityUrnOf(o: Obj): string | null {
  const json = JSON.stringify(o);
  const urn = json.match(/urn:li:activity:\d+/)?.[0] ?? json.match(/urn:li:(?:ugcPost|share):\d+/)?.[0];
  if (urn) return urn;
  const fromUrl = (pick(o, ["url", "post_url", "postUrl", "share_url", "shareUrl", "link"]) ?? "").match(/activity[-:](\d{15,})/)?.[1];
  if (fromUrl) return `urn:li:activity:${fromUrl}`;
  const id = typeof o.id === "number" ? String(o.id) : str(o.id);
  return id && /^\d{15,}$/.test(id) ? `urn:li:activity:${id}` : null;
}

/** First array (depth-first) whose items look like posts. */
function postRows(data: unknown, depth = 0): Obj[] {
  if (depth > 5) return [];
  if (Array.isArray(data)) {
    const objs = data.filter(isObj);
    if (objs.length && objs.some((o) => activityUrnOf(o))) return objs;
    for (const v of data) { const r = postRows(v, depth + 1); if (r.length) return r; }
    return [];
  }
  if (isObj(data)) {
    for (const k of ["output", "posts", "data", "items", "results", "elements"]) if (k in data) { const r = postRows(data[k], depth + 1); if (r.length) return r; }
    for (const v of Object.values(data)) { const r = postRows(v, depth + 1); if (r.length) return r; }
  }
  return [];
}

function textOfPost(o: Obj): string {
  for (const k of ["text", "commentary", "content", "postText", "post_text", "description", "body"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (isObj(v) && typeof v.text === "string") return v.text.trim();
  }
  return "";
}

function dateOfPost(o: Obj, urn: string): string | null {
  for (const k of ["posted_at", "postedAt", "postedDate", "published_at", "publishedAt", "created_at", "createdAt", "createdUtc", "date", "time", "timestamp"]) {
    const v = o[k];
    const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : typeof v === "string" ? new Date(v) : isObj(v) && typeof v.timestamp === "number" ? new Date(v.timestamp) : null;
    if (d && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  return timeFromActivityUrn(urn);
}

export function toPostRef(o: Obj): PostRef | null {
  const urn = activityUrnOf(o);
  if (!urn) return null;
  const url = pick(o, ["url", "post_url", "postUrl", "share_url", "shareUrl", "link"]) ?? `https://www.linkedin.com/feed/update/${urn}/`;
  return { activityUrn: urn, text: textOfPost(o), postedAt: dateOfPost(o, urn), url };
}

const posts = (data: unknown, limit: number) => postRows(data).map(toPostRef).filter((p): p is PostRef => !!p).slice(0, limit);

export async function tregRecentPosts(workspaceId: string, entity: EntityRef, count = 5): Promise<PostRef[]> {
  if (entity.kind === "company") {
    const r = await tregCall("anyapi.linkedin.company_posts_thin", { workspaceId, purpose: "posts", body: { url: entityUrl(entity) }, maxCostUsd: 0.01 });
    return posts(r.data, count);
  }
  const r = await tregCall("treg.linkedin.user.posts", { workspaceId, purpose: "posts", body: { linkedin_url: entityUrl(entity), limit: count }, maxCostUsd: 0.02 });
  return posts(r.data, count);
}

export async function tregSearchPosts(workspaceId: string, keyword: string, count = 5): Promise<PostRef[]> {
  const r = await tregCall("anyapi.linkedin.search.posts.full", { workspaceId, purpose: "post_search", body: { query: keyword, datePosted: "last-week", limit: Math.min(50, Math.max(1, count)) }, maxCostUsd: 0.05 });
  return posts(r.data, count);
}

function split(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] || null, lastName: parts.slice(1).join(" ") || null };
}

/** People who reacted to / commented on a post (one call: up to 100 of each). */
export async function tregPostEngagers(workspaceId: string, post: PostRef, opts: { reactions?: number } = {}): Promise<Engager[]> {
  const r = await tregCall<Obj>("fetchinio.linkedin.post.engagement", {
    workspaceId, purpose: "engagement", method: "GET", maxCostUsd: 0.01,
    query: { postUrlOrUrn: post.activityUrn, reactionCount: Math.min(100, Math.max(1, opts.reactions ?? 100)), commentCount: 100 },
  });
  const body = isObj(r.data) && isObj(r.data.output) ? r.data.output : r.data;
  const out: Engager[] = [];
  for (const item of (isObj(body) && Array.isArray(body.reactions) ? body.reactions : []) as Obj[]) {
    const a = isObj(item.actor) ? item.actor : item;
    const name = pick(a, ["name", "fullName"]);
    if (!name) continue;
    out.push({ name, ...split(name), headline: pick(a, ["headline"]), profileUrl: profileUrlFor(pick(a, ["profileUrl", "url"])) ?? pick(a, ["profileUrl", "url"]),
      memberUrn: pick(a, ["urn", "id"]), imageUrl: pick(a, ["profilePictureUrl", "picture"]), kind: "reaction", reactionType: pick(item, ["reactionType", "type"]), commentText: null });
  }
  for (const item of (isObj(body) && Array.isArray(body.comments) ? body.comments : []) as Obj[]) {
    const a = isObj(item.author) ? item.author : item;
    const name = pick(a, ["name", "fullName"]);
    if (!name) continue;
    out.push({ name, ...split(name), headline: pick(a, ["headline"]), profileUrl: profileUrlFor(pick(a, ["profileUrl", "url"])) ?? pick(a, ["profileUrl", "url"]),
      memberUrn: pick(a, ["id", "urn"]), imageUrl: pick(a, ["profilePictureUrl", "picture"]), kind: "comment", reactionType: null, commentText: str(item.text) });
  }
  // A person who both reacted and commented counts once, as the comment (stronger intent).
  // Company pages react too: they aren't people to contact.
  const byKey = new Map<string, Engager>();
  for (const e of out.filter((x) => !x.profileUrl || /linkedin\.com\/in\//.test(x.profileUrl))) {
    const key = e.profileUrl ?? e.memberUrn ?? e.name;
    const prev = byKey.get(key);
    if (!prev || (prev.kind === "reaction" && e.kind === "comment")) byKey.set(key, e);
  }
  return [...byKey.values()];
}

export interface TregProfile {
  full_name: string | null; first_name: string | null; last_name: string | null; headline: string | null; about: string | null;
  location: string | null; linkedin_url: string | null; current: { company: string | null; title: string | null; started: string | null; companyUrl?: string | null } | null;
}

/** The current job from a vendor's raw profile (experience lists differ per vendor). */
export function currentPosition(raw: unknown): TregProfile["current"] {
  let found: TregProfile["current"] = null;
  const visit = (v: unknown, depth: number) => {
    if (found || depth > 6) return;
    if (Array.isArray(v)) {
      for (const it of v) {
        if (!isObj(it)) continue;
        const company = pick(it, ["company", "companyName", "company_name", "organization", "subtitle"]) ?? (isObj(it.company) ? pick(it.company as Obj, ["name"]) : null);
        const title = pick(it, ["title", "position", "role", "jobTitle"]);
        if (!company) continue;
        const end = it.end ?? it.endDate ?? it.end_date ?? it.ends_at ?? it.endsAt;
        const isCurrent = it.is_current === true || it.isCurrent === true || it.current === true || end == null || end === "" || (typeof end === "string" && /present|current/i.test(end));
        if (isCurrent) {
          const s = it.start ?? it.startDate ?? it.start_date ?? it.starts_at;
          const started = typeof s === "string" ? s || null :isObj(s) && s.year ? `${s.year}-${String(s.month ?? 1).padStart(2, "0")}-01` : null;
          const companyUrl = pick(it, ["companyUrl", "company_url", "companyLinkedinUrl", "company_linkedin_url"]) ?? (isObj(it.company) ? pick(it.company as Obj, ["url", "linkedinUrl"]) : null);
          found = { company: company.split(" · ")[0], title, started, companyUrl };
          return;
        }
      }
      for (const it of v) visit(it, depth + 1);
    } else if (isObj(v)) {
      for (const k of ["experience", "experiences", "positions", "position", "work_experience", "jobs"]) if (k in v) visit(v[k], depth + 1);
      if (!found) for (const val of Object.values(v)) visit(val, depth + 1);
    }
  };
  visit(raw, 0);
  return found;
}

/** Public profile (headline, about, current job). Null when no provider has it. */
export async function tregProfile(workspaceId: string, url: string): Promise<TregProfile | null> {
  const linkedin_url = profileUrlFor(url);
  if (!linkedin_url) return null;
  let r;
  try {
    r = await tregCall<Obj>("treg.linkedin.user.profile", { workspaceId, purpose: "profile", body: { linkedin_url }, maxCostUsd: 0.02 });
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number | null }).status === 404) return null;
    throw err;
  }
  const o = isObj(r.data) && isObj(r.data.output) ? r.data.output : null;
  if (!o || !str(o.full_name)) return null;
  return {
    full_name: str(o.full_name), first_name: str(o.first_name), last_name: str(o.last_name), headline: str(o.headline), about: str(o.about),
    location: str(o.location), linkedin_url: str(o.linkedin_url), current: currentPosition(isObj(r.data) ? r.data.raw : null),
  };
}

export interface TregCompany { name: string; description: string | null; website: string | null; employees: string | null; location: string | null; industry: string | null; linkedin_url: string | null }

/** Company page firmographics (size, description, website; industry when the vendor has it). */
export async function tregCompany(workspaceId: string, url: string): Promise<TregCompany | null> {
  const m = url.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i);
  if (!m) return null;
  let r;
  try {
    r = await tregCall<Obj>("treg.linkedin.company.profile", { workspaceId, purpose: "company", body: { linkedin_url: `https://www.linkedin.com/company/${m[1]}/` }, maxCostUsd: 0.01 });
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number | null }).status === 404) return null;
    throw err;
  }
  const o = isObj(r.data) && isObj(r.data.output) ? r.data.output : null;
  if (!o || !str(o.name)) return null;
  let industry: string | null = null;
  const find = (v: unknown, d: number): void => {
    if (industry || d > 5) return;
    if (isObj(v)) { const i = v.industry ?? v.industries; if (typeof i === "string") industry = i; else if (Array.isArray(i) && typeof i[0] === "string") industry = i[0]; else for (const x of Object.values(v)) find(x, d + 1); }
  };
  find(isObj(r.data) ? r.data.raw : null, 0);
  return { name: str(o.name)!, description: str(o.description), website: str(o.website), employees: typeof o.employees === "number" ? String(o.employees) : str(o.employees), location: str(o.location), industry, linkedin_url: str(o.linkedin_url) };
}
