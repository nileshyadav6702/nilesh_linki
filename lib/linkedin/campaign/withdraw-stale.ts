import { getDb } from "@/lib/db";
import { getSessionPage } from "@/lib/linkedin/session";
import { withdrawInvitation, type WithdrawOutcome } from "@/lib/linkedin/withdraw";
import { linkedinActionsToday } from "@/lib/linkedin/actions";
import { withinActiveHours } from "@/lib/signals/linkedin-discovery";
import { sendLinkedinAction, saveSessionAfterSend } from "./step-helpers";
import { log, nowIso } from "./track-state";

/**
 * Withdraw invitations still pending after the invitation step's `withdraw_after_days`
 * (default 30, 0 = never), so open invitations don't pile up and hurt the account. Runs as one
 * phase of the account's worker unit: a few per pass, a small daily cap, inside active hours.
 */

/** Withdrawals per account per day, and per worker pass. */
export const WITHDRAW_DAILY_CAP = 10;
const PER_PASS = 3;
const DEFAULT_WITHDRAW_DAYS = 30;

export interface StaleInvitation { run_id: string; track_id: string; step_id: string; target_id: string; full_name: string | null; linkedin_url: string; created_at: string }

/** Sent invitations from this account that are past their withdraw window and still not accepted. */
export function staleInvitations(db: ReturnType<typeof getDb>, accountId: string, limit: number): StaleInvitation[] {
  return db.prepare(`SELECT la.run_id, la.track_id, la.step_id, la.target_id, t.full_name, t.linkedin_url, la.created_at
    FROM linkedin_actions la
    JOIN targets t ON t.id = la.target_id
    LEFT JOIN workflow_steps ws ON ws.id = la.step_id
    WHERE la.account_id = ? AND la.type = 'connect' AND la.status = 'sent'
      AND COALESCE(ws.withdraw_after_days, ${DEFAULT_WITHDRAW_DAYS}) > 0
      AND la.created_at < datetime('now', '-' || COALESCE(ws.withdraw_after_days, ${DEFAULT_WITHDRAW_DAYS}) || ' days')
      AND t.connected_at IS NULL AND COALESCE(t.degree, 0) != 1 AND t.linkedin_url LIKE '%linkedin.com/in/%'
      AND NOT EXISTS (SELECT 1 FROM linkedin_actions w WHERE w.type = 'withdraw' AND w.account_id = la.account_id AND w.target_id = la.target_id)
    ORDER BY la.created_at LIMIT ?`).all(accountId, limit) as StaleInvitation[];
}

export async function withdrawStaleInvitations(accountId: string, opts: { shouldStop?: () => boolean } = {}): Promise<number> {
  const db = getDb();
  const account = db.prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(accountId) as
    { id: string; is_authenticated: number; active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null } | undefined;
  if (!account?.is_authenticated || !withinActiveHours(account)) return 0;
  const left = WITHDRAW_DAILY_CAP - linkedinActionsToday(db, accountId, "withdraw", account.timezone ?? "UTC");
  if (left <= 0) return 0;

  let done = 0;
  for (const inv of staleInvitations(db, accountId, Math.min(left, PER_PASS))) {
    if (opts.shouldStop?.()) break;
    const name = inv.full_name ?? inv.linkedin_url;
    const input = { key: `li:withdraw:${accountId}:${inv.target_id}`, type: "withdraw" as const, accountId, runId: inv.run_id, trackId: inv.track_id, stepId: inv.step_id, targetId: inv.target_id };
    const result: { outcome: WithdrawOutcome } = { outcome: "not_pending" };
    try {
      const sent = await sendLinkedinAction(db, input, async () => {
        const page = await getSessionPage(accountId);
        try { result.outcome = await withdrawInvitation(page, inv.linkedin_url); } finally { await page.close(); }
      });
      if (!sent.claimed) continue;
    } catch (err) {
      log(db, inv.run_id, inv.target_id, "warn", `Could not withdraw the invitation to ${name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    await saveSessionAfterSend(accountId);
    const { outcome } = result;
    if (outcome === "connected") {
      db.prepare("UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?").run(nowIso(), inv.target_id);
      log(db, inv.run_id, inv.target_id, "info", `${name} had accepted — nothing to withdraw`);
    } else {
      log(db, inv.run_id, inv.target_id, "info", outcome === "withdrawn" ? `Withdrew the unaccepted invitation to ${name}` : `No pending invitation to ${name} to withdraw`);
      done += outcome === "withdrawn" ? 1 : 0;
    }
  }
  return done;
}

