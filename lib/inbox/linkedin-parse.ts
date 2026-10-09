/**
 * Pure parsers for LinkedIn's messaging GraphQL responses (messengerConversations,
 * messengerMessages). No Node or DB imports so they can be unit-tested on captured payloads.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | null => (isObj(v) && typeof v.text === "string" && v.text.trim() ? v.text.trim() : null);
const typeOf = (o: Obj) => String(o._type ?? o.$type ?? "");

function collect(v: unknown, out: Obj[], depth = 0) {
  if (depth > 18 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) collect(x, out, depth + 1); return; }
  out.push(v as Obj);
  for (const x of Object.values(v as Obj)) if (x && typeof x === "object") collect(x, out, depth + 1);
}

export interface ParsedParticipant { name: string; headline: string | null; url: string | null; photo: unknown; self: boolean }

export function participant(p: unknown): ParsedParticipant | null {
  if (!isObj(p) || !isObj(p.participantType)) return null;
  const m = p.participantType.member;
  if (isObj(m)) {
    const name = [text(m.firstName), text(m.lastName)].filter(Boolean).join(" ") || "LinkedIn Member";
    return { name, headline: text(m.headline), url: typeof m.profileUrl === "string" ? m.profileUrl : null, photo: m.profilePicture ?? null, self: m.distance === "SELF" };
  }
  const o = p.participantType.organization;
  if (isObj(o)) return { name: text(o.name) ?? "LinkedIn Page", headline: text(o.tagline), url: typeof o.pageUrl === "string" ? o.pageUrl : null, photo: o.logo ?? null, self: false };
  const c = p.participantType.custom;
  if (isObj(c)) return { name: text(c.name) ?? "LinkedIn", headline: null, url: null, photo: c.image ?? null, self: false };
  return null;
}

export interface ParsedMessage { externalId: string; direction: "in" | "out"; senderName: string | null; bodyText: string; sentAt: string }

export function parseMessage(m: Obj): ParsedMessage | null {
  const id = typeof m.backendUrn === "string" ? m.backendUrn : typeof m.entityUrn === "string" ? m.entityUrn : null;
  if (!id || typeof m.deliveredAt !== "number") return null;
  const sender = participant(m.sender);
  const recalled = m.messageBodyRenderFormat === "RECALLED";
  const body = recalled ? "This message was deleted." : text(m.body) ?? (typeof m.renderContentFallbackText === "string" ? m.renderContentFallbackText : null) ?? "Attachment";
  return { externalId: id, direction: sender?.self ? "out" : "in", senderName: sender?.name ?? null, bodyText: body, sentAt: new Date(m.deliveredAt).toISOString() };
}

export interface ParsedConversation {
  externalId: string; entityUrn: string; url: string | null; title: string | null; lastActivityAt: string; unread: boolean;
  other: ParsedParticipant | null; preview: ParsedMessage | null;
}

export function parseConversations(json: unknown): ParsedConversation[] {
  const objs: Obj[] = [];
  collect(json, objs);
  const seen = new Set<string>();
  const out: ParsedConversation[] = [];
  for (const c of objs) {
    if (!typeOf(c).endsWith("messenger.Conversation") || typeof c.entityUrn !== "string" || typeof c.lastActivityAt !== "number") continue;
    const ext = typeof c.backendUrn === "string" ? c.backendUrn : c.entityUrn;
    if (seen.has(ext)) continue;
    seen.add(ext);
    const parts = (Array.isArray(c.conversationParticipants) ? c.conversationParticipants : []).map(participant).filter((p): p is ParsedParticipant => !!p);
    const msgs = isObj(c.messages) && Array.isArray(c.messages.elements) ? c.messages.elements.filter(isObj).map(parseMessage).filter((m): m is ParsedMessage => !!m) : [];
    out.push({
      externalId: ext, entityUrn: c.entityUrn, url: typeof c.conversationUrl === "string" ? c.conversationUrl : null,
      title: typeof c.title === "string" ? c.title : text(c.title), lastActivityAt: new Date(c.lastActivityAt).toISOString(),
      unread: (typeof c.unreadCount === "number" && c.unreadCount > 0) || c.read === false,
      other: parts.find((p) => !p.self) ?? null, preview: msgs.sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0] ?? null,
    });
  }
  return out;
}

export function parseMessages(json: unknown): ParsedMessage[] {
  const objs: Obj[] = [];
  collect(json, objs);
  const seen = new Set<string>();
  return objs.filter((o) => typeOf(o).endsWith("messenger.Message")).map(parseMessage)
    .filter((m): m is ParsedMessage => !!m && !seen.has(m.externalId) && !!seen.add(m.externalId))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/** The messengerMessages query id the page itself used (LinkedIn rotates these). */
export function messagesQueryId(urls: string[]): string | null {
  for (const u of urls) {
    const m = u.match(/queryId=(messengerMessages\.[0-9a-f]+)&variables=\(conversationUrn:/);
    if (m) return m[1];
  }
  return null;
}

/** Rest.li-encoded GraphQL path for one conversation's messages. */
export function messagesPath(queryId: string, conversationUrn: string): string {
  const enc = encodeURIComponent(conversationUrn).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${queryId}&variables=(conversationUrn:${enc})`;
}
