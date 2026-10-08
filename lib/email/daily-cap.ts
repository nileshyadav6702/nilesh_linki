import type Database from "better-sqlite3";
import { campaignEmailsToday } from "@/lib/linkedin/actions";
import { effectiveEmailLimit } from "@/lib/linkedin/campaign/schedule";
import type { EmailAccountLimits } from "@/lib/linkedin/campaign/types";

/**
 * Per-mailbox daily cap for one-off sends (contact thread, team inbox, public API).
 *
 * Campaign steps enforce the same cap (plus pacing and working hours) in the runner. One-off
 * sends are a person or integration acting deliberately, so they skip pacing, but they spend
 * the same daily allowance — otherwise a mailbox's real volume was the cap plus whatever was
 * sent by hand, which is exactly the burst the cap exists to prevent.
 */
export class MailboxDailyCapError extends Error {
  constructor(public readonly sentToday: number, public readonly dailyLimit: number) {
    super(`Daily sending limit reached for this mailbox (${sentToday}/${dailyLimit}). Try again tomorrow or raise the mailbox's daily limit.`);
  }
}

export function mailboxDailyUsage(db: Database.Database, emailAccountId: string): { sentToday: number; dailyLimit: number } | null {
  const limits = db.prepare(
    "SELECT daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, ramp_up_enabled, ramp_start_date FROM email_accounts WHERE id = ?",
  ).get(emailAccountId) as EmailAccountLimits | undefined;
  if (!limits) return null;
  const dailyLimit = effectiveEmailLimit({ ...limits, daily_email_limit: limits.daily_email_limit ?? 50 });
  return { sentToday: campaignEmailsToday(db, emailAccountId, limits.timezone || "UTC"), dailyLimit };
}

/** Throws MailboxDailyCapError when the mailbox has no allowance left today. */
export function assertMailboxCapacity(db: Database.Database, emailAccountId: string): void {
  const usage = mailboxDailyUsage(db, emailAccountId);
  if (usage && usage.sentToday >= usage.dailyLimit) throw new MailboxDailyCapError(usage.sentToday, usage.dailyLimit);
}
