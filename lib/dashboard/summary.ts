import type Database from "better-sqlite3";
import { periodDays, type Period } from "@/lib/insights/report";

/**
 * Home dashboard: what needs doing next, the period's headline numbers, daily activity,
 * the hottest new leads and the latest replies. Hot = AI score 70+ (three flames).
 */

export interface DashboardDay { day: string; leads: number; invitations: number; messages: number; emails: number }
export interface HotLead { id: string; full_name: string | null; title: string | null; headline: string | null; company: string | null; profile_image_url: string | null; score: number }
export interface Reply { id: string; channel: string; name: string | null; photo: string | null; snippet: string | null; at: string | null; interested: number }
export interface DashboardSummary {
  period: Period;
  activeSignals: number; linkedinAccounts: number;
  next: { total: number; invitations: number; messages: number; nextAt: string | null };
  hot: number; invitations: number; messages: number; replies: number;
  dealSize: number | null;
  series: DashboardDay[];
  hotLeads: HotLead[]; latestReplies: Reply[];
}

const SCORE = "COALESCE(t.lead_score, t.intent_score)";
const dealKey = (ws: string) => `deal_size:${ws}`;

export function getDealSize(db: Database.Database, ws: string): number | null {
  const v = (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(dealKey(ws)) as { value: string } | undefined)?.value;
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setDealSize(db: Database.Database, ws: string, value: number | null) {
  if (value === null) { db.prepare("DELETE FROM app_settings WHERE key = ?").run(dealKey(ws)); return; }
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(dealKey(ws), String(value));
}

export function dashboardSummary(db: Database.Database, ws: string, p: Period): DashboardSummary {
  const from = p.from, toEnd = p.to;
  // Compare on date(): ISO ("2026-10-08T…Z") and SQLite ("2026-10-08 …") timestamps are both stored, and as
  // text an ISO time on the last day sorts after "2026-10-08 23:59:59", so a time bound would drop it.
  const inP = (col: string) => `date(${col}) BETWEEN ? AND ?`;
  const count = (sql: string) => (db.prepare(sql).get(ws, from, toEnd) as { n: number }).n;

  const activeSignals = (db.prepare(`SELECT COUNT(*) n FROM agent_sources s JOIN agents a ON a.id = s.agent_id
    WHERE a.workspace_id = ? AND s.enabled = 1 AND a.status = 'active'`).get(ws) as { n: number }).n;
  const linkedinAccounts = (db.prepare("SELECT COUNT(*) n FROM accounts WHERE workspace_id = ? AND is_authenticated = 1").get(ws) as { n: number }).n;

  // Campaign steps due within a day, by what they will send.
  const due = db.prepare(`SELECT ws2.step_type type, COUNT(DISTINCT rp.target_id) n, MIN(rt.next_step_at) next_at
    FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
    JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN workflow_steps ws2 ON ws2.workflow_id = r.workflow_id AND ws2.track = rt.track AND ws2.step_order = rt.current_step
    WHERE w.workspace_id = ? AND r.status = 'running' AND rt.state IN ('pending','in_progress')
      AND (rt.next_step_at IS NULL OR datetime(rt.next_step_at) <= datetime('now','+1 day'))
    GROUP BY 1`).all(ws) as Array<{ type: string | null; n: number; next_at: string | null }>;
  const invitationsDue = due.filter((d) => d.type === "connect").reduce((a, d) => a + d.n, 0);
  const messagesDue = due.filter((d) => d.type && ["message", "inmail", "sales_inmail", "voice", "email"].includes(d.type)).reduce((a, d) => a + d.n, 0);
  const nextSource = (db.prepare(`SELECT MIN(s.next_run_at) at FROM agent_sources s JOIN agents a ON a.id = s.agent_id
    WHERE a.workspace_id = ? AND s.enabled = 1 AND a.status = 'active' AND s.next_run_at IS NOT NULL`).get(ws) as { at: string | null }).at;
  const nextAt = [nextSource, ...due.map((d) => d.next_at)].filter((x): x is string => !!x).map((x) => x.replace(" ", "T")).sort()[0] ?? null;

  const hot = count(`SELECT COUNT(*) n FROM targets t WHERE t.workspace_id = ? AND ${SCORE} >= 70 AND ${inP("t.created_at")}`);
  const invitations = count(`SELECT COUNT(*) n FROM targets t WHERE t.workspace_id = ? AND ${inP("t.connection_requested_at")}`);
  const messages = count(`SELECT COUNT(*) n FROM targets t WHERE t.workspace_id = ? AND (${inP("t.message_sent_at")})`);
  const replies = count(`SELECT COUNT(*) n FROM targets t WHERE t.workspace_id = ? AND ${inP("COALESCE(t.last_replied_at, t.email_replied_at)")}`);

  const bucket = (sql: string) => new Map((db.prepare(sql).all(ws, from, toEnd) as Array<{ d: string; n: number }>).map((r) => [r.d, r.n]));
  const leads = bucket(`SELECT date(created_at) d, COUNT(*) n FROM targets WHERE workspace_id = ? AND ${inP("created_at")} GROUP BY 1`);
  const inv = bucket(`SELECT date(connection_requested_at) d, COUNT(*) n FROM targets WHERE workspace_id = ? AND ${inP("connection_requested_at")} GROUP BY 1`);
  const msg = bucket(`SELECT date(message_sent_at) d, COUNT(*) n FROM targets WHERE workspace_id = ? AND ${inP("message_sent_at")} GROUP BY 1`);
  const mail = bucket(`SELECT date(updated_at) d, COUNT(*) n FROM email_jobs WHERE workspace_id = ? AND status = 'sent' AND ${inP("updated_at")} GROUP BY 1`);
  const series = periodDays(p).map((d) => ({ day: d, leads: leads.get(d) ?? 0, invitations: inv.get(d) ?? 0, messages: msg.get(d) ?? 0, emails: mail.get(d) ?? 0 }));

  const hotLeads = db.prepare(`SELECT t.id, t.full_name, t.title, t.headline, t.company, t.profile_image_url, ${SCORE} score
    FROM targets t WHERE t.workspace_id = ? AND ${SCORE} >= 70 ORDER BY t.created_at DESC, ${SCORE} DESC LIMIT 5`).all(ws) as HotLead[];
  const latestReplies = db.prepare(`SELECT id, channel, participant_name name, participant_photo photo, snippet, last_message_at at, interested
    FROM inbox_threads WHERE workspace_id = ? AND has_inbound = 1 AND deleted = 0 ORDER BY last_message_at DESC LIMIT 5`).all(ws) as Reply[];

  return {
    period: p, activeSignals, linkedinAccounts,
    next: { total: invitationsDue + messagesDue, invitations: invitationsDue, messages: messagesDue, nextAt },
    hot, invitations, messages, replies, dealSize: getDealSize(db, ws), series, hotLeads, latestReplies,
  };
}
