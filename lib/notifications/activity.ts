import type Database from "better-sqlite3";
import { campaignDigests } from "./digests";
import type { FeedItem } from "./types";

const iso = (s: string | null | undefined) => (s ? (/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`) : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const DAYS = "-14 days";

/**
 * What happened, newest first: each day's outreach, replies (interested ones called out),
 * invitations accepted, new leads found, meetings booked, campaigns finished, leads that
 * couldn't be contacted, and bounces / unsubscribes.
 */
export function activityItems(db: Database.Database, workspaceId: string): FeedItem[] {
  const out: FeedItem[] = [];

  for (const d of campaignDigests(db, workspaceId)) {
    const parts = [plural(d.messages, "message"), plural(d.invites, "invite"), plural(d.visits, "visit")];
    if (d.emails) parts.push(plural(d.emails, "email"));
    out.push({ id: `campaign:${d.day}`, kind: "campaign", tone: "info", title: `${plural(d.leads, "lead")} contacted`,
      text: `${d.today ? "So far today" : "Campaign completed"} : ${parts.join(", ")}`, href: "/agents", at: d.at });
  }

  // Unread replies from leads (not newsletters or other mail in the inbox); an interested one says so.
  const replies = db.prepare(`SELECT it.id, it.participant_name name, it.participant_photo photo, it.snippet, it.last_message_at at, it.channel, t.reply_kind
    FROM inbox_threads it LEFT JOIN targets t ON t.id = it.target_id
    WHERE it.workspace_id = ? AND it.target_id IS NOT NULL AND it.unread = 1 AND it.has_inbound = 1 AND it.deleted = 0 AND it.archived = 0
    ORDER BY it.last_message_at DESC LIMIT 15`).all(workspaceId) as Array<{ id: string; name: string | null; photo: string | null; snippet: string | null; at: string | null; channel: string; reply_kind: string | null }>;
  for (const r of replies) {
    const who = r.name ?? "Someone";
    const positive = r.reply_kind === "positive";
    out.push({ id: `reply:${r.id}`, kind: "reply", tone: positive ? "good" : "info", photo: r.photo, href: "/inbox", at: iso(r.at),
      title: positive ? `${who} is interested` : `${who} replied on ${r.channel === "email" ? "email" : "LinkedIn"}`, text: r.snippet });
  }

  // Per day: invitations accepted, new leads found (per agent).
  const accepted = db.prepare(`SELECT date(connected_at) d, COUNT(*) n, MAX(connected_at) at FROM targets
    WHERE workspace_id = ? AND connected_at >= datetime('now', ?) AND connection_requested_at IS NOT NULL GROUP BY 1`).all(workspaceId, DAYS) as Array<{ d: string; n: number; at: string }>;
  for (const a of accepted) out.push({ id: `accepted:${a.d}`, kind: "activity", tone: "good", title: `${plural(a.n, "invitation")} accepted`, text: "They're now connections; their next steps continue automatically.", href: "/agents", at: iso(a.at) });

  const found = db.prepare(`SELECT date(t.created_at) d, g.id agent_id, g.name, COUNT(*) n, MAX(t.created_at) at FROM targets t JOIN agents g ON g.id = t.agent_id
    WHERE t.workspace_id = ? AND t.created_at >= datetime('now', ?) GROUP BY 1, 2`).all(workspaceId, DAYS) as Array<{ d: string; agent_id: string; name: string; n: number; at: string }>;
  for (const f of found) out.push({ id: `found:${f.d}:${f.agent_id}`, kind: "activity", tone: "info", title: `${plural(f.n, "new lead")} found`, text: `By ${f.name}`, href: `/agents/${f.agent_id}`, at: iso(f.at) });

  // Meetings booked.
  const meetings = db.prepare(`SELECT m.id, m.title, m.starts_at, m.created_at at, t.full_name FROM meetings m LEFT JOIN targets t ON t.id = m.target_id
    WHERE m.workspace_id = ? AND m.created_at >= datetime('now', ?) ORDER BY m.created_at DESC LIMIT 10`).all(workspaceId, DAYS) as Array<{ id: string; title: string; starts_at: string; at: string; full_name: string | null }>;
  for (const m of meetings) {
    const when = new Date(iso(m.starts_at)!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    out.push({ id: `meeting:${m.id}`, kind: "activity", tone: "good", title: m.full_name ? `Meeting booked with ${m.full_name}` : "Meeting booked", text: `${m.title} · ${when}`, href: "/todos", at: iso(m.at) });
  }

  // Campaigns that finished (every lead done).
  const finished = db.prepare(`SELECT r.id, r.completed_at at, COALESCE(g.name, w.name, 'A campaign') name, g.id agent_id,
      (SELECT COUNT(*) FROM run_profiles rp WHERE rp.run_id = r.id) leads
    FROM runs r LEFT JOIN agents g ON g.id = r.agent_id LEFT JOIN workflows w ON w.id = r.workflow_id
    WHERE r.workspace_id = ? AND r.status = 'completed' AND r.completed_at >= datetime('now', ?)`).all(workspaceId, DAYS) as Array<{ id: string; at: string; name: string; agent_id: string | null; leads: number }>;
  for (const r of finished) out.push({ id: `run-done:${r.id}`, kind: "activity", tone: "info", title: `${r.name}: sequence finished`, text: `All ${plural(r.leads, "lead")} have been through every step.`, href: r.agent_id ? `/agents/${r.agent_id}` : "/agents", at: iso(r.at) });

  // Leads whose sequence failed (after retries), per day.
  const failed = db.prepare(`SELECT date(rt.last_step_at) d, COUNT(DISTINCT rp.target_id) n, MAX(rt.last_step_at) at, MAX(rt.error_message) why
    FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
    WHERE r.workspace_id = ? AND rt.state = 'failed' AND rt.last_step_at >= datetime('now', ?) GROUP BY 1`).all(workspaceId, DAYS) as Array<{ d: string; n: number; at: string; why: string | null }>;
  for (const f of failed) out.push({ id: `failed:${f.d}`, kind: "activity", tone: "alert", title: `${plural(f.n, "lead")} couldn't be contacted`, text: f.why ? `e.g. ${f.why.slice(0, 120)}` : "A step kept failing after retries.", href: "/agents", at: iso(f.at) });

  // Bounces and spam complaints, per day.
  const bounces = db.prepare(`SELECT date(occurred_at) d, COUNT(CASE WHEN event_type = 'bounced' THEN 1 END) b, COUNT(CASE WHEN event_type = 'complained' THEN 1 END) c, MAX(occurred_at) at
    FROM sender_events WHERE workspace_id = ? AND event_type IN ('bounced','complained') AND occurred_at >= datetime('now', ?) GROUP BY 1`).all(workspaceId, DAYS) as Array<{ d: string; b: number; c: number; at: string }>;
  for (const e of bounces) {
    const parts = [e.b ? plural(e.b, "email") + " bounced" : null, e.c ? `${plural(e.c, "recipient")} marked you as spam` : null].filter(Boolean);
    out.push({ id: `bounce:${e.d}`, kind: "activity", tone: "alert", title: parts.join(", "), text: "Those addresses are now on your do-not-send list.", href: "/email-health", at: iso(e.at) });
  }

  // Unsubscribes, per day.
  const unsubs = db.prepare(`SELECT date(created_at) d, COUNT(*) n, MAX(created_at) at FROM suppressions
    WHERE workspace_id = ? AND reason = 'unsubscribe' AND created_at >= datetime('now', ?) GROUP BY 1`).all(workspaceId, DAYS) as Array<{ d: string; n: number; at: string }>;
  for (const u of unsubs) out.push({ id: `unsub:${u.d}`, kind: "activity", tone: "info", title: `${plural(u.n, "person")} unsubscribed`.replace("persons", "people"), text: "They won't be emailed again.", href: "/settings?tab=blocklist", at: iso(u.at) });

  return out;
}
