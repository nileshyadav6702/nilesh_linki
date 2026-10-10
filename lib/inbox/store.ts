import { randomUUID } from "crypto";
import { recordLinkedInReply } from "@/lib/inbox/replies";
import type Database from "better-sqlite3";

/**
 * Unified inbox storage: threads (one LinkedIn conversation or one email thread) and their
 * messages, synced from the workspace's connected accounts, plus local triage flags
 * (unread, interested, archived, deleted). Pure SQL; the sync modules feed it.
 */

export type Channel = "linkedin" | "email";

export interface ThreadInput {
  workspaceId: string; channel: Channel; accountId: string; externalId: string; url?: string | null; subject?: string | null;
  participantName?: string | null; participantHeadline?: string | null; participantEmail?: string | null; participantUrl?: string | null; participantPhoto?: string | null;
  snippet?: string | null; lastMessageAt: string; unread?: boolean;
}

export interface MessageInput { externalId: string; direction: "in" | "out"; senderName?: string | null; senderEmail?: string | null; bodyText?: string | null; bodyHtml?: string | null; sentAt: string }

const norm = (u: string | null | undefined) => (u ? u.toLowerCase().replace(/\/+$/, "") : null);

/**
 * The workspace contact a conversation is with: by profile URL, by LinkedIn member id (messaging
 * shows /in/ACoAA… while a contact may be stored under its public URL, or the reverse), or email.
 */
export function findParticipantContact(db: Database.Database, workspaceId: string, participantUrl: string | null | undefined, participantEmail: string | null | undefined): string | null {
  if (participantUrl) {
    const row = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND lower(rtrim(linkedin_url, '/')) = ?").get(workspaceId, norm(participantUrl)) as { id: string } | undefined;
    if (row) return row.id;
    const handle = participantUrl.match(/linkedin\.com\/in\/([^/?#,]+)/i)?.[1];
    if (handle) {
      const byId = db.prepare(`SELECT id FROM targets WHERE workspace_id = ? AND (linkedin_member_urn = ? OR messaging_urn LIKE ? OR lower(rtrim(linkedin_url, '/')) LIKE ?) LIMIT 1`)
        .get(workspaceId, `urn:li:fsd_profile:${handle}`, `%${handle}%`, `%/in/${handle.toLowerCase()}`) as { id: string } | undefined;
      if (byId) return byId.id;
    }
  }
  if (participantEmail) {
    const row = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND lower(email) = lower(?)").get(workspaceId, participantEmail) as { id: string } | undefined;
    if (row) return row.id;
  }
  return null;
}

const matchTarget = (db: Database.Database, t: ThreadInput) => findParticipantContact(db, t.workspaceId, t.participantUrl, t.participantEmail);

/**
 * Insert or refresh a thread. A deleted thread stays deleted unless new activity arrives;
 * unread follows the source only when the thread has new activity (local "mark as unread" sticks).
 */
export function upsertThread(db: Database.Database, t: ThreadInput): { id: string; changed: boolean } {
  const existing = db.prepare("SELECT id, last_message_at FROM inbox_threads WHERE channel = ? AND account_id = ? AND external_id = ?")
    .get(t.channel, t.accountId, t.externalId) as { id: string; last_message_at: string | null } | undefined;
  if (existing) {
    const changed = !existing.last_message_at || t.lastMessageAt > existing.last_message_at;
    db.prepare(`UPDATE inbox_threads SET url = COALESCE(?, url), subject = COALESCE(?, subject), participant_name = COALESCE(?, participant_name),
        participant_headline = COALESCE(?, participant_headline), participant_email = COALESCE(?, participant_email), participant_url = COALESCE(?, participant_url),
        participant_photo = COALESCE(?, participant_photo), snippet = CASE WHEN ? THEN COALESCE(?, snippet) ELSE snippet END,
        last_message_at = CASE WHEN ? THEN ? ELSE last_message_at END,
        unread = CASE WHEN ? THEN ? ELSE unread END, deleted = CASE WHEN ? THEN 0 ELSE deleted END, archived = CASE WHEN ? THEN 0 ELSE archived END,
        target_id = COALESCE(target_id, ?)
      WHERE id = ?`).run(t.url ?? null, t.subject ?? null, t.participantName ?? null, t.participantHeadline ?? null, t.participantEmail ?? null, t.participantUrl ?? null,
      t.participantPhoto ?? null, changed ? 1 : 0, t.snippet ?? null, changed ? 1 : 0, t.lastMessageAt, changed && t.unread !== undefined ? 1 : 0, t.unread ? 1 : 0,
      changed ? 1 : 0, changed ? 1 : 0, matchTarget(db, t), existing.id);
    return { id: existing.id, changed };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO inbox_threads (id, workspace_id, channel, account_id, external_id, url, subject, participant_name, participant_headline, participant_email,
      participant_url, participant_photo, target_id, snippet, last_message_at, unread) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, t.workspaceId, t.channel, t.accountId, t.externalId, t.url ?? null, t.subject ?? null, t.participantName ?? null, t.participantHeadline ?? null,
      t.participantEmail ?? null, t.participantUrl ?? null, t.participantPhoto ?? null, matchTarget(db, t), t.snippet ?? null, t.lastMessageAt, t.unread ? 1 : 0);
  return { id, changed: true };
}

export function addMessages(db: Database.Database, threadId: string, messages: MessageInput[]): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO inbox_messages (id, thread_id, external_id, direction, sender_name, sender_email, body_text, body_html, sent_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let added = 0;
  db.transaction(() => {
    for (const m of messages) added += ins.run(randomUUID(), threadId, m.externalId, m.direction, m.senderName ?? null, m.senderEmail ?? null, m.bodyText ?? null, m.bodyHtml ?? null, m.sentAt).changes;
    db.prepare(`UPDATE inbox_threads SET messages_synced_at = datetime('now'),
        has_inbound = CASE WHEN EXISTS (SELECT 1 FROM inbox_messages WHERE thread_id = ? AND direction = 'in') THEN 1 ELSE has_inbound END WHERE id = ?`).run(threadId, threadId);
  })();
  // A lead answering our LinkedIn outreach ends their sequences.
  if (added && messages.some((m) => m.direction === "in")) recordLinkedInReply(db, threadId);
  return added;
}

// ─── listing ───────────────────────────────────────────────────────────────────

export type InboxFilter = "received" | "interested" | "unread" | "all";
/** "all", "linkedin", "email", "linkedin:<accountId>" or "email:<accountId>". */
export type AccountScope = string;

function scopeWhere(scope: AccountScope): { sql: string; params: unknown[] } {
  const [channel, id] = scope.split(":");
  if (channel !== "linkedin" && channel !== "email") return { sql: "", params: [] };
  return id ? { sql: " AND t.channel = ? AND t.account_id = ?", params: [channel, id] } : { sql: " AND t.channel = ?", params: [channel] };
}

const FILTER_SQL: Record<InboxFilter, string> = {
  received: " AND t.has_inbound = 1 AND t.archived = 0",
  interested: " AND t.interested = 1",
  unread: " AND t.unread = 1 AND t.archived = 0",
  all: "",
};

/** A LinkedIn seat set to "only conversations with my contacts" hides threads with people who aren't contacts. */
const HIDDEN = " AND t.channel = 'linkedin' AND t.target_id IS NULL AND EXISTS (SELECT 1 FROM accounts sa WHERE sa.id = t.account_id AND sa.inbox_contacts_only = 1)";
const CONTACTS_ONLY = ` AND NOT (${HIDDEN.slice(5)})`;

export function listThreads(db: Database.Database, workspaceId: string, opts: { scope: AccountScope; filter: InboxFilter; q?: string | null; limit?: number; offset?: number }) {
  const s = scopeWhere(opts.scope);
  const params: unknown[] = [workspaceId, ...s.params];
  let sql = `SELECT t.id, t.channel, t.account_id, t.subject, t.participant_name, t.participant_headline, t.participant_email, t.participant_url, t.participant_photo,
      t.target_id, t.snippet, t.last_message_at, t.unread, t.interested, t.archived, t.has_inbound
    FROM inbox_threads t WHERE t.workspace_id = ? AND t.deleted = 0${s.sql}${FILTER_SQL[opts.filter]}`;
  if (opts.q) {
    const like = `%${opts.q}%`;
    sql += " AND (t.participant_name LIKE ? OR t.participant_email LIKE ? OR t.subject LIKE ? OR t.snippet LIKE ?)";
    params.push(like, like, like, like);
  }
  // Conversations the contacts-only setting hides from this view, so the inbox can say why it looks empty.
  const hidden = (db.prepare(`SELECT COUNT(*) n FROM (${sql}${HIDDEN})`).get(...params) as { n: number }).n;
  sql += CONTACTS_ONLY;
  const total = (db.prepare(`SELECT COUNT(*) n FROM (${sql})`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${sql} ORDER BY t.last_message_at DESC LIMIT ? OFFSET ?`).all(...params, opts.limit ?? 50, opts.offset ?? 0);
  return { total, hidden, threads: rows };
}

/** Thread counts per account (and per channel) for the account switcher. */
export function accountCounts(db: Database.Database, workspaceId: string) {
  const rows = db.prepare(`SELECT channel, account_id, COUNT(*) n FROM inbox_threads t WHERE workspace_id = ? AND deleted = 0${CONTACTS_ONLY} GROUP BY channel, account_id`).all(workspaceId) as Array<{ channel: Channel; account_id: string; n: number }>;
  const linkedin = db.prepare("SELECT id, name, email FROM accounts WHERE workspace_id = ? ORDER BY created_at").all(workspaceId) as Array<{ id: string; name: string | null; email: string | null }>;
  const email = db.prepare("SELECT id, from_email, from_name, provider FROM email_accounts WHERE workspace_id = ? ORDER BY created_at").all(workspaceId) as Array<{ id: string; from_email: string | null; from_name: string | null; provider: string | null }>;
  const count = (ch: Channel, id?: string) => rows.filter((r) => r.channel === ch && (!id || r.account_id === id)).reduce((n, r) => n + r.n, 0);
  return {
    all: count("linkedin") + count("email"),
    linkedin: { total: count("linkedin"), accounts: linkedin.map((a) => ({ id: a.id, name: a.name ?? a.email ?? "LinkedIn account", count: count("linkedin", a.id) })) },
    email: { total: count("email"), accounts: email.map((a) => ({ id: a.id, name: a.from_email ?? a.from_name ?? "Mailbox", provider: a.provider ?? "smtp", count: count("email", a.id) })) },
  };
}

export function getThread(db: Database.Database, workspaceId: string, id: string) {
  const thread = db.prepare("SELECT * FROM inbox_threads WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!thread) return null;
  const messages = db.prepare("SELECT id, direction, sender_name, sender_email, body_text, body_html, sent_at FROM inbox_messages WHERE thread_id = ? ORDER BY sent_at").all(id);
  return { thread, messages };
}

export const TRIAGE_FIELDS = ["unread", "interested", "archived", "deleted"] as const;
export type TriageField = (typeof TRIAGE_FIELDS)[number];

export function setTriage(db: Database.Database, workspaceId: string, id: string, patch: Partial<Record<TriageField, boolean>>): boolean {
  const sets = TRIAGE_FIELDS.filter((f) => patch[f] !== undefined);
  if (!sets.length) return false;
  const r = db.prepare(`UPDATE inbox_threads SET ${sets.map((f) => `${f} = ?`).join(", ")} WHERE id = ? AND workspace_id = ?`)
    .run(...sets.map((f) => (patch[f] ? 1 : 0)), id, workspaceId);
  return r.changes > 0;
}
