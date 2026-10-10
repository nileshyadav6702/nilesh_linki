import type Database from "better-sqlite3";
import { billingSummary } from "@/lib/credits/ledger";
import type { FeedItem } from "./types";

const iso = (s: string | null | undefined) => (s ? (/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`) : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Things that need the user, as long as they're true: a disconnected sender, a paused mailbox,
 * LinkedIn's weekly limit, credits, leads stuck on a step, failing lead sources, sends that may
 * or may not have gone out, and leads waiting for review. Each disappears once it's resolved.
 */
export function alertItems(db: Database.Database, workspaceId: string): FeedItem[] {
  const out: FeedItem[] = [];

  // A LinkedIn sender signed out (or never signed in) while outreach depends on it.
  const disconnected = db.prepare(`SELECT a.id, a.name, a.email, a.disconnected_at at FROM accounts a
    WHERE a.workspace_id = ? AND COALESCE(a.is_authenticated, 0) = 0
      AND (EXISTS (SELECT 1 FROM runs r WHERE r.account_id = a.id AND r.status IN ('running','pending'))
        OR EXISTS (SELECT 1 FROM agents g WHERE g.linkedin_account_id = a.id AND g.outreach_enabled = 1))`)
    .all(workspaceId) as Array<{ id: string; name: string | null; email: string; at: string | null }>;
  for (const a of disconnected) {
    out.push({ id: `alert:li-auth:${a.id}`, kind: "alert", tone: "alert", title: `Reconnect ${a.name || a.email} on LinkedIn`,
      text: "LinkedIn signed this account out — its invitations and messages are on hold until you reconnect.", href: "/settings?tab=senders", at: iso(a.at) });
  }

  // LinkedIn's own weekly invitation limit.
  const blocked = db.prepare(`SELECT id, name, email, connects_blocked_until until, connects_blocked_at at FROM accounts
    WHERE workspace_id = ? AND connects_blocked_until > ?`).all(workspaceId, new Date().toISOString()) as Array<{ id: string; name: string | null; email: string; until: string; at: string | null }>;
  for (const a of blocked) {
    out.push({ id: `alert:li-weekly:${a.id}`, kind: "alert", tone: "alert", title: `Weekly invitation limit reached for ${a.name || a.email}`,
      text: `LinkedIn stopped new invitations; they resume ${day(a.until)}. Messages to connections continue.`, href: "/settings?tab=senders", at: iso(a.at) });
  }

  // Mailboxes paused (by hand, a refused login, or the bounce / complaint policy) or cooling down.
  const mailboxes = db.prepare(`SELECT id, from_email, paused_at, paused_reason, cooldown_until FROM email_accounts
    WHERE workspace_id = ? AND (paused_at IS NOT NULL OR cooldown_until > ?)`).all(workspaceId, new Date().toISOString()) as Array<{ id: string; from_email: string; paused_at: string | null; paused_reason: string | null; cooldown_until: string | null }>;
  for (const m of mailboxes) {
    out.push(m.paused_at
      ? { id: `alert:mailbox:${m.id}`, kind: "alert", tone: "alert", title: `Sending paused for ${m.from_email}`, text: m.paused_reason ?? "Resume the mailbox to continue its emails.", href: "/email-health", at: iso(m.paused_at) }
      : { id: `alert:mailbox-cool:${m.id}`, kind: "alert", tone: "info", title: `${m.from_email} is cooling down`, text: `The mail provider is limiting it; sending resumes ${new Date(m.cooldown_until!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`, href: "/email-health", at: null });
  }

  // Credits: out, or under a tenth of the monthly refill.
  try {
    const b = billingSummary(db, workspaceId);
    const lastUse = (db.prepare("SELECT MAX(created_at) t FROM credit_ledger WHERE workspace_id = ?").get(workspaceId) as { t: string | null }).t;
    if (b.balance <= 0) out.push({ id: "alert:credits:out", kind: "alert", tone: "alert", title: "You're out of credits", text: `Lead finding and AI writing are paused until credits refill on ${day(b.next_refill_at)} or you add more.`, href: "/settings?tab=billing", at: iso(lastUse) });
    else if (b.next_refill > 0 && b.balance < b.next_refill * 0.1) out.push({ id: "alert:credits:low", kind: "alert", tone: "info", title: `Credits running low — ${b.balance} left`, text: `They refill on ${day(b.next_refill_at)}.`, href: "/settings?tab=billing", at: iso(lastUse) });
  } catch { /* billing not set up for this workspace */ }

  // Leads held on a step until the user fixes something (empty step, AI key / credits).
  const held = db.prepare(`SELECT rt.wait_reason reason, COUNT(DISTINCT rp.target_id) n, MAX(rt.last_step_at) at
    FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
    WHERE r.workspace_id = ? AND r.status IN ('running','paused') AND rt.state = 'in_progress'
      AND (rt.wait_reason LIKE 'Nothing to send%' OR rt.wait_reason LIKE 'AI writing blocked%')
    GROUP BY rt.wait_reason`).all(workspaceId) as Array<{ reason: string; n: number; at: string | null }>;
  for (const h of held) {
    out.push({ id: `alert:held:${h.reason}`, kind: "alert", tone: "alert", title: `${plural(h.n, "lead")} on hold`, text: h.reason, href: "/agents", at: iso(h.at) });
  }

  // LinkedIn sends whose outcome is unknown (the page died mid-send): check before anything is resent.
  const uncertain = db.prepare(`SELECT COUNT(*) n, MAX(la.updated_at) at FROM linkedin_actions la JOIN accounts a ON a.id = la.account_id
    WHERE a.workspace_id = ? AND la.status = 'uncertain' AND la.updated_at >= datetime('now', '-14 days')`).get(workspaceId) as { n: number; at: string | null };
  if (uncertain.n) out.push({ id: "alert:uncertain", kind: "alert", tone: "info", title: `${plural(uncertain.n, "LinkedIn send")} to double-check`, text: "We couldn't confirm these went out, so they won't be sent again automatically.", href: "/agents", at: iso(uncertain.at) });

  // Lead sources that failed in the last day (a daily budget being reached is pacing, not a failure).
  const failing = db.prepare(`SELECT g.id, g.name, COUNT(*) n, MAX(dr.started_at) at, MAX(dr.error) error FROM detector_runs dr
    JOIN agent_sources s ON s.id = dr.agent_source_id JOIN agents g ON g.id = s.agent_id
    WHERE dr.workspace_id = ? AND dr.error IS NOT NULL AND dr.error NOT LIKE '%budget reached%' AND dr.started_at >= datetime('now', '-1 day') GROUP BY g.id`).all(workspaceId) as Array<{ id: string; name: string; n: number; at: string; error: string }>;
  for (const f of failing) {
    out.push({ id: `alert:source:${f.id}`, kind: "alert", tone: "info", title: `${f.name}: a lead source failed`, text: f.error.slice(0, 160), href: `/agents/${f.id}`, at: iso(f.at) });
  }

  // Copilot: messages waiting for approval.
  const pending = db.prepare("SELECT COUNT(DISTINCT target_id) n, MAX(created_at) at FROM approval_queue WHERE workspace_id = ? AND status = 'pending'").get(workspaceId) as { n: number; at: string | null };
  if (pending.n) out.push({ id: "alert:approval", kind: "approval", tone: "info", title: `${plural(pending.n, "lead")} waiting for your review`, text: "Approve or reject their messages in Copilot.", href: "/copilot", at: iso(pending.at) });

  return out;
}
