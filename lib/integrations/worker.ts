import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { appByKey } from "@/lib/integrations/catalog";
import { adapterFor } from "@/lib/integrations/adapters";
import { webhookList } from "@/lib/integrations/adapters/webhook";
import { getConnection, leadFor, setStatus, type Connection } from "@/lib/integrations/store";
import { IntegrationError, type Lead, type Reply } from "@/lib/integrations/types";

/**
 * Outbound sync. Each pass, per connected app:
 *  1. queues leads qualified since the app was connected (when "automatically send" is on),
 *  2. queues inbound replies since then (reply notes, or a reply webhook),
 *  3. sends what is due. Failures back off; permanent ones (bad key, bad data) stop, and a
 *     rejected key marks the connection so the page can say so.
 * Leads a tool can't take without an email wait up to a week for the email to be found.
 */

type DB = Database.Database;
const SENT_STATUSES = "('qualified','drafted','approved','enrolled')";
const MAX_ATTEMPTS = 6;
const EMAIL_WAIT_DAYS = 7;

function queue(db: DB, ws: string, app: string, kind: "contact" | "reply", targetId: string | null, ref: string): void {
  db.prepare("INSERT OR IGNORE INTO integration_syncs (id, workspace_id, app, kind, target_id, ref) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), ws, app, kind, targetId, ref);
}

function wantsReplies(c: Connection): boolean {
  return c.app === "webhook" ? webhookList(c.config).some((w) => w.trigger === "reply") : !!c.options.reply_notes;
}
function wantsLeads(c: Connection): boolean {
  return c.app === "webhook" ? !!c.options.auto_sync && webhookList(c.config).some((w) => w.trigger === "lead") : !!c.options.auto_sync;
}

export function enqueueNew(db: DB, ws: string, c: Connection, limit = 200): void {
  if (wantsLeads(c)) {
    const rows = db.prepare(`SELECT t.id FROM targets t WHERE t.workspace_id = ? AND t.agent_status IN ${SENT_STATUSES} AND t.agent_status_at >= ?
      AND NOT EXISTS (SELECT 1 FROM integration_syncs s WHERE s.workspace_id = t.workspace_id AND s.app = ? AND s.kind = 'contact' AND s.ref = t.id)
      ORDER BY t.agent_status_at LIMIT ?`).all(ws, c.created_at, c.app, limit) as Array<{ id: string }>;
    for (const r of rows) queue(db, ws, c.app, "contact", r.id, r.id);
  }
  if (wantsReplies(c)) {
    const rows = db.prepare(`SELECT m.id, th.target_id FROM inbox_messages m JOIN inbox_threads th ON th.id = m.thread_id
      WHERE th.workspace_id = ? AND m.direction = 'in' AND m.sent_at >= ?
        AND NOT EXISTS (SELECT 1 FROM integration_syncs s WHERE s.workspace_id = th.workspace_id AND s.app = ? AND s.kind = 'reply' AND s.ref = m.id)
      ORDER BY m.sent_at LIMIT ?`).all(ws, c.created_at, c.app, limit) as Array<{ id: string; target_id: string | null }>;
    for (const r of rows) queue(db, ws, c.app, "reply", r.target_id, r.id);
  }
}

/** "Sync now": queue every lead the agents have qualified, not just new ones. */
export function enqueueAllLeads(db: DB, ws: string, app: string, limit = 5000): number {
  const rows = db.prepare(`SELECT t.id FROM targets t WHERE t.workspace_id = ? AND t.agent_status IN ${SENT_STATUSES}
    AND NOT EXISTS (SELECT 1 FROM integration_syncs s WHERE s.workspace_id = t.workspace_id AND s.app = ? AND s.kind = 'contact' AND s.ref = t.id)
    ORDER BY t.lead_score DESC LIMIT ?`).all(ws, app, limit) as Array<{ id: string }>;
  db.transaction(() => { for (const r of rows) queue(db, ws, app, "contact", r.id, r.id); })();
  // Failed ones get another try too.
  const retried = db.prepare("UPDATE integration_syncs SET status = 'pending', attempts = 0, next_attempt_at = datetime('now'), last_error = NULL WHERE workspace_id = ? AND app = ? AND kind = 'contact' AND status = 'failed'").run(ws, app).changes;
  return rows.length + retried;
}

function replyFor(db: DB, messageId: string): { reply: Reply; fallback: Lead } | null {
  const r = db.prepare(`SELECT m.id, m.body_text, m.sent_at, th.channel, th.subject, th.account_id, th.participant_name, th.participant_email, th.participant_url, th.participant_headline
    FROM inbox_messages m JOIN inbox_threads th ON th.id = m.thread_id WHERE m.id = ?`).get(messageId) as
    { id: string; body_text: string | null; sent_at: string; channel: string; subject: string | null; account_id: string; participant_name: string | null; participant_email: string | null; participant_url: string | null; participant_headline: string | null } | undefined;
  if (!r) return null;
  const teammate = r.channel === "email"
    ? (db.prepare("SELECT COALESCE(from_name, from_email) n FROM email_accounts WHERE id = ?").get(r.account_id) as { n: string } | undefined)?.n
    : (db.prepare("SELECT name n FROM accounts WHERE id = ?").get(r.account_id) as { n: string } | undefined)?.n;
  const [first, ...rest] = (r.participant_name ?? "").split(/\s+/);
  return {
    reply: { id: r.id, channel: r.channel === "email" ? "email" : "linkedin", message: (r.body_text ?? "").slice(0, 5000), subject: r.subject, received_at: r.sent_at, teammate: teammate ?? null },
    fallback: { id: r.id, first_name: first || null, last_name: rest.join(" ") || null, full_name: r.participant_name, email: r.participant_email, title: null, headline: r.participant_headline,
      company: null, company_domain: null, linkedin_url: r.participant_url, phone: null, location: null, lead_score: null, agent: null },
  };
}

interface SyncRow { id: string; workspace_id: string; app: string; kind: "contact" | "reply"; target_id: string | null; ref: string; attempts: number; created_at: string }

async function sendOne(db: DB, row: SyncRow, c: Connection): Promise<void> {
  const def = appByKey(row.app);
  const adapter = adapterFor(row.app);
  if (!def || !adapter) throw new IntegrationError("This app can't sync", true);
  let external: string | null;
  if (row.kind === "contact") {
    const lead = row.target_id ? leadFor(db, row.target_id) : null;
    if (!lead) throw new IntegrationError("The lead was deleted", true);
    if (def.needsEmail && !lead.email) {
      const ageDays = (Date.now() - Date.parse(`${row.created_at.replace(" ", "T")}Z`)) / 86_400_000;
      if (ageDays > EMAIL_WAIT_DAYS) throw new IntegrationError(`${def.name} needs an email address and none was found`, true);
      db.prepare("UPDATE integration_syncs SET next_attempt_at = datetime('now', '+6 hours'), last_error = 'Waiting for an email address' WHERE id = ?").run(row.id);
      return;
    }
    external = await adapter.pushContact(c.config, lead, { verify: !!c.options.verify_on_import });
  } else {
    const found = replyFor(db, row.ref);
    if (!found) throw new IntegrationError("The reply was deleted", true);
    const lead = (row.target_id ? leadFor(db, row.target_id) : null) ?? found.fallback;
    if (!adapter.addReply) throw new IntegrationError(`${def.name} doesn't take replies`, true);
    external = await adapter.addReply(c.config, lead, found.reply, { create: !!c.options.create_on_reply });
  }
  db.prepare("UPDATE integration_syncs SET status = 'done', external_id = ?, last_error = NULL, done_at = datetime('now'), attempts = attempts + 1 WHERE id = ?").run(external, row.id);
  db.prepare("UPDATE integration_connections SET last_synced_at = datetime('now') WHERE workspace_id = ? AND app = ?").run(row.workspace_id, row.app);
}

export async function processDue(db: DB, limit = 25): Promise<number> {
  const rows = db.prepare(`SELECT s.* FROM integration_syncs s JOIN integration_connections c ON c.workspace_id = s.workspace_id AND c.app = s.app
    WHERE s.status = 'pending' AND s.next_attempt_at <= datetime('now') AND c.status = 'connected' ORDER BY s.next_attempt_at LIMIT ?`).all(limit) as SyncRow[];
  for (const row of rows) {
    const c = getConnection(db, row.workspace_id, row.app);
    if (!c || c.status !== "connected") continue;
    try {
      await sendOne(db, row, c);
    } catch (err) {
      const e = err instanceof IntegrationError ? err : new IntegrationError(err instanceof Error ? err.message : String(err));
      const attempts = row.attempts + 1;
      const failed = e.permanent || attempts >= MAX_ATTEMPTS;
      db.prepare(`UPDATE integration_syncs SET status = ?, attempts = ?, last_error = ?, next_attempt_at = datetime('now', ?) WHERE id = ?`)
        .run(failed ? "failed" : "pending", attempts, e.message.slice(0, 500), `+${Math.min(2 ** attempts * 5, 360)} minutes`, row.id);
      // A rejected key fails every row the same way: stop the app until it's reconnected.
      if (e.status === 401 || e.status === 403) setStatus(db, row.workspace_id, row.app, "error", e.message);
    }
  }
  return rows.length;
}

/** One pass for every connected app (runner loop). */
export async function runIntegrationSync(db: DB = getDb()): Promise<number> {
  const conns = db.prepare("SELECT workspace_id, app FROM integration_connections WHERE status = 'connected'").all() as Array<{ workspace_id: string; app: string }>;
  for (const { workspace_id, app } of conns) {
    const c = getConnection(db, workspace_id, app);
    if (c) enqueueNew(db, workspace_id, c);
  }
  return processDue(db);
}
