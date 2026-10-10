import type Database from "better-sqlite3";
import { holdForOutOfOffice, isOutOfOffice, stopAutomation } from "@/lib/community-replies";

/**
 * A LinkedIn conversation with a lead got a message from them after our first outreach: that is
 * a reply. The lead is marked replied (targets.last_replied_at) and every sequence they are in
 * stops (tracks skipped, queued campaign emails cancelled). Email replies have their own path
 * (lib/email/inbox.ts → community-replies).
 */

const ms = (s: string | null | undefined) => (s ? Date.parse(/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`) : NaN);

/** Returns true when this thread produced a new reply. */
export function recordLinkedInReply(db: Database.Database, threadId: string): boolean {
  const thread = db.prepare("SELECT channel, account_id, target_id FROM inbox_threads WHERE id = ?").get(threadId) as
    { channel: string; account_id: string; target_id: string | null } | undefined;
  if (!thread || thread.channel !== "linkedin" || !thread.target_id) return false;
  // Our first campaign touch on LinkedIn from this account (invitation, message, voice, InMail).
  const first = (db.prepare(`SELECT MIN(created_at) t FROM linkedin_actions WHERE target_id = ? AND account_id = ?
    AND type IN ('connect','message','voice','inmail') AND status IN ('sent','uncertain')`).get(thread.target_id, thread.account_id) as { t: string | null }).t;
  if (!first) return false; // not someone we reached out to: an ordinary conversation
  const latest = db.prepare("SELECT sent_at t, body_text FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY sent_at DESC LIMIT 1").get(threadId) as { t: string | null; body_text: string | null } | undefined;
  const inbound = latest?.t ?? null;
  if (!inbound || !(ms(inbound) > ms(first))) return false;
  // An away message isn't a reply: hold the sequence until they're back instead of ending it.
  if (isOutOfOffice(latest?.body_text ?? "")) {
    const { until, held } = holdForOutOfOffice(thread.target_id, ms(inbound), null, JSON.stringify({ reply: latest?.body_text, summary: "LinkedIn auto-reply" }));
    if (held) {
      const runs = db.prepare("SELECT DISTINCT rp.run_id FROM run_profiles rp WHERE rp.target_id = ?").all(thread.target_id) as Array<{ run_id: string }>;
      for (const r of runs) db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (lower(hex(randomblob(16))), ?, ?, 'info', ?)")
        .run(r.run_id, thread.target_id, `Auto-reply on LinkedIn (away) — next steps held until ${until.slice(0, 10)}`);
    }
    return false;
  }
  const target = db.prepare("SELECT last_replied_at, full_name FROM targets WHERE id = ?").get(thread.target_id) as { last_replied_at: string | null; full_name: string | null } | undefined;
  if (!target || (target.last_replied_at && ms(target.last_replied_at) >= ms(inbound))) return false;
  db.prepare("UPDATE targets SET last_replied_at = ? WHERE id = ?").run(new Date(ms(inbound)).toISOString(), thread.target_id);
  stopAutomation(thread.target_id, "Lead replied on LinkedIn");
  const runs = db.prepare("SELECT DISTINCT rp.run_id FROM run_profiles rp WHERE rp.target_id = ?").all(thread.target_id) as Array<{ run_id: string }>;
  const log = db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (lower(hex(randomblob(16))), ?, ?, 'info', ?)");
  for (const r of runs) log.run(r.run_id, thread.target_id, `${target.full_name ?? "The lead"} replied on LinkedIn — sequence stopped`);
  return true;
}
