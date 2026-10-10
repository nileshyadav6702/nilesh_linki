import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/**
 * Invitations recorded as sent but missing from LinkedIn's own "Sent" list never went out (or
 * were lost). They are put back in line: the claim becomes 'failed' (so the step may send
 * again), the "requested" mark is cleared, and the lead's invitation step runs on the next tick.
 *
 * Only leads with a public profile URL can be matched (the Sent page links to public handles);
 * acceptances are synced first so an accepted invitation is never mistaken for a missing one,
 * and a resend that meets an existing invitation or connection is recognised as such.
 */

type DB = Database.Database;

/** Too fresh to judge (LinkedIn's list can lag a few minutes) or too old to matter. */
const MIN_AGE = "-30 minutes";
const MAX_AGE = "-30 days";

export interface ReconcileResult { checked: number; requeued: string[]; skipped: number }

const vanityOf = (url: string | null): string | null => {
  const m = url?.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m || /^ACo[A-Za-z0-9_-]{20,}$/i.test(m[1])) return null;
  return decodeURIComponent(m[1]).toLowerCase();
};

/** Decide and apply, given the vanity names LinkedIn lists as pending. Pure DB; testable. */
export function requeueMissingInvites(db: DB, accountId: string, pending: Set<string>): ReconcileResult {
  const rows = db.prepare(`SELECT la.id action_id, la.track_id, la.step_id, t.id target_id, t.full_name, t.linkedin_url, r.id run_id
      FROM linkedin_actions la JOIN targets t ON t.id = la.target_id
      LEFT JOIN run_profile_tracks rt ON rt.id = la.track_id LEFT JOIN run_profiles rp ON rp.id = rt.run_profile_id LEFT JOIN runs r ON r.id = rp.run_id
     WHERE la.account_id = ? AND la.type = 'connect' AND la.status = 'sent'
       AND la.updated_at < datetime('now', ?) AND la.updated_at > datetime('now', ?)
       AND t.connected_at IS NULL AND COALESCE(t.degree, 0) != 1
       AND NOT EXISTS (SELECT 1 FROM linkedin_actions w WHERE w.target_id = t.id AND w.type = 'withdraw')`)
    .all(accountId, MIN_AGE, MAX_AGE) as Array<{ action_id: string; track_id: string | null; step_id: string | null; target_id: string; full_name: string | null; linkedin_url: string | null; run_id: string | null }>;
  const result: ReconcileResult = { checked: 0, requeued: [], skipped: 0 };
  // An empty or failed scrape can't tell "nothing pending" from "couldn't read": do nothing.
  if (!pending.size) return { ...result, skipped: rows.length };
  const fail = db.prepare("UPDATE linkedin_actions SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sent'");
  const clear = db.prepare("UPDATE targets SET connection_requested_at = NULL WHERE id = ?");
  const rerun = db.prepare("UPDATE run_profile_tracks SET next_step_at = datetime('now') WHERE id = ? AND state = 'in_progress'");
  const log = db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (lower(hex(randomblob(16))), ?, ?, 'warn', ?)");
  db.transaction(() => {
    for (const r of rows) {
      const v = vanityOf(r.linkedin_url);
      if (!v) { result.skipped++; continue; }
      result.checked++;
      if (pending.has(v)) continue;
      fail.run("Not in LinkedIn's sent invitations — will send again", r.action_id);
      clear.run(r.target_id);
      if (r.track_id) rerun.run(r.track_id);
      if (r.run_id) log.run(r.run_id, r.target_id, `Invitation to ${r.full_name ?? v} is not on LinkedIn's sent list — sending it again`);
      result.requeued.push(r.target_id);
    }
  })();
  return result;
}

/** Read LinkedIn's Sent invitations with the account's session and requeue what's missing. */
export async function reconcileSentInvitations(accountId: string): Promise<ReconcileResult> {
  const { getSessionPage } = await import("@/lib/linkedin/session");
  const { scrapePendingInvitationVanityNames } = await import("@/lib/linkedin/pending-invitations");
  const page = await getSessionPage(accountId);
  let pending: Set<string>;
  try { pending = await scrapePendingInvitationVanityNames(page); } finally { await page.close().catch(() => {}); }
  const r = requeueMissingInvites(getDb(), accountId, pending);
  if (r.requeued.length) console.log(`[invite-reconcile] ${r.requeued.length} invitation(s) missing on LinkedIn — requeued`);
  return r;
}
