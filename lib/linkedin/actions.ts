import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { localDayBoundsUtc, localWeekStartUtc } from "@/lib/outreach/schedule";

/**
 * Claim-before-send for LinkedIn actions, atomic track claims and the structured daily-cap
 * counters the runner enforces limits from.
 *
 * Why: the runner's step watchdog stops the CALLER waiting but cannot cancel a Playwright
 * step, and a process can die between LinkedIn accepting a message and the track advancing.
 * Either way the track stayed due and the next tick sent the same message again. Email has
 * had an idempotent job table for this; LinkedIn now has the same contract:
 *
 *   sending   - claimed, browser about to be / being driven
 *   sent      - LinkedIn accepted it
 *   failed    - the send threw a known error; a later attempt may retry
 *   uncertain - an attempt never reported back (timeout, crash). NEVER auto-retried: the
 *               track moves on and the log tells a human to check LinkedIn.
 */

type DB = Database.Database;

export type LinkedinActionType = "connect" | "message" | "inmail" | "visit" | "like" | "voice" | "withdraw";
export type LinkedinActionStatus = "sending" | "sent" | "failed" | "uncertain";

/** One action per (run, track, step): the same step never sends twice. */
export function linkedinActionKey(type: LinkedinActionType, runId: string, trackId: string, stepId: string): string {
  return `li:${type}:${runId}:${trackId}:${stepId}`;
}

export interface LinkedinActionInput {
  key: string;
  type: LinkedinActionType;
  accountId: string | null;
  runId: string;
  trackId: string;
  stepId: string;
  targetId: string;
}

export type ClaimResult =
  | { claimed: true; id: string }
  | { claimed: false; id: string; status: "sent" | "uncertain" };

/** Status of an earlier attempt at this key, if any. Read-only. */
export function priorLinkedinAction(db: DB, key: string): { id: string; status: LinkedinActionStatus } | undefined {
  return db.prepare("SELECT id, status FROM linkedin_actions WHERE idempotency_key = ?").get(key) as
    | { id: string; status: LinkedinActionStatus }
    | undefined;
}

const UNREPORTED = "A previous attempt never reported back (step timed out or the worker stopped mid-send)";

/**
 * Claim the right to perform this action. Returns claimed=false, with the reason, when it has
 * already been sent or its outcome is uncertain. A row still in 'sending' means an earlier
 * attempt never finished: it is converted to 'uncertain' here rather than retried.
 */
export function claimLinkedinAction(db: DB, input: LinkedinActionInput): ClaimResult {
  return db.transaction((): ClaimResult => {
    const prior = priorLinkedinAction(db, input.key);
    if (!prior) {
      const id = randomUUID();
      db.prepare(`INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending')`).run(id, input.key, input.accountId, input.runId, input.trackId, input.stepId, input.targetId, input.type);
      return { claimed: true, id };
    }
    if (prior.status === "failed") {
      db.prepare(`UPDATE linkedin_actions SET status = 'sending', attempt = attempt + 1, last_error = NULL,
        created_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'failed'`).run(prior.id);
      return { claimed: true, id: prior.id };
    }
    if (prior.status === "sending") {
      db.prepare(`UPDATE linkedin_actions SET status = 'uncertain', last_error = COALESCE(last_error, ?), updated_at = datetime('now')
        WHERE id = ? AND status = 'sending'`).run(UNREPORTED, prior.id);
      return { claimed: false, id: prior.id, status: "uncertain" };
    }
    return { claimed: false, id: prior.id, status: prior.status };
  })();
}

/** LinkedIn accepted it. Also resolves an 'uncertain' row whose orphaned attempt finished later. */
export function markLinkedinActionSent(db: DB, id: string): void {
  db.prepare("UPDATE linkedin_actions SET status = 'sent', last_error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('sending','uncertain')").run(id);
}

/**
 * The page or browser died under the step. That can happen AFTER the send button was clicked,
 * so the action may have gone out: not a known failure.
 */
export function isAmbiguousSendError(error: unknown): boolean {
  // A message that may have gone out (sent but unconfirmed, or a split message cut short).
  if (error instanceof Error && error.name === "MessageMaybeSentError") return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /has been closed|target closed|target page|browser.*(closed|disconnected)|crash/i.test(msg);
}

/** Record the outcome of a send that threw: 'failed' (retry allowed) or, when ambiguous, 'uncertain'. */
export function markLinkedinActionAfterError(db: DB, id: string, error: unknown): void {
  // "Already pending" means the invitation exists: it counts as sent (cap, withdraw-stale, reconcile).
  if (error instanceof Error && error.name === "PendingInviteError") return markLinkedinActionSent(db, id);
  if (!isAmbiguousSendError(error)) return markLinkedinActionFailed(db, id, error);
  const msg = error instanceof Error ? error.message : String(error);
  db.prepare("UPDATE linkedin_actions SET status = 'uncertain', last_error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sending'").run(msg.slice(0, 500), id);
}

/**
 * Outcome of an earlier attempt that must NOT be repeated: 'sent', or 'uncertain' (a row
 * still 'sending' is converted to 'uncertain' here). Null when there is none or it failed.
 */
export function settledPriorAction(db: DB, key: string): "sent" | "uncertain" | null {
  const prior = priorLinkedinAction(db, key);
  if (!prior || prior.status === "failed") return null;
  if (prior.status === "sending") {
    db.prepare(`UPDATE linkedin_actions SET status = 'uncertain', last_error = COALESCE(last_error, ?), updated_at = datetime('now')
      WHERE id = ? AND status = 'sending'`).run(UNREPORTED, prior.id);
    return "uncertain";
  }
  return prior.status;
}

/** A known failure: retry is allowed. Never downgrades an 'uncertain' row (it may have gone out). */
export function markLinkedinActionFailed(db: DB, id: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  db.prepare("UPDATE linkedin_actions SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sending'").run(msg.slice(0, 500), id);
}

/** A step on this track was abandoned by the watchdog: whatever it was sending is now uncertain. */
export function markTrackActionsUncertain(db: DB, trackId: string, reason: string): number {
  return db.prepare("UPDATE linkedin_actions SET status = 'uncertain', last_error = ?, updated_at = datetime('now') WHERE track_id = ? AND status = 'sending'")
    .run(reason.slice(0, 500), trackId).changes;
}

/** Boot/tick recovery: a 'sending' row older than any legitimate step is from a dead attempt. */
export function recoverStaleLinkedinActions(db: DB, olderThanMinutes = 10): number {
  return db.prepare(`UPDATE linkedin_actions SET status = 'uncertain', last_error = COALESCE(last_error, ?), updated_at = datetime('now')
    WHERE status = 'sending' AND updated_at < datetime('now', ?)`).run(UNREPORTED, `-${olderThanMinutes} minutes`).changes;
}

// ─── daily caps ──────────────────────────────────────────────────────────────

/** Log prefixes the pre-structured counters used. Only a transition floor now (see below). */
const LEGACY_LOG_PREFIX: Record<LinkedinActionType, string> = {
  connect: "Connection request sent%",
  message: "Message sent%",
  inmail: "InMail sent%",
  visit: "Visited %",
  // Newer actions are only ever counted from linkedin_actions; these never match a log line.
  like: "\u0000like",
  voice: "\u0000voice",
  withdraw: "\u0000withdraw",
};

/**
 * Actions of `type` this account has spent today, on the ACCOUNT's calendar day. Counts
 * 'sending' and 'uncertain' too: an attempt that may have gone out has spent its slot.
 * The legacy log count is kept only as a floor so the day this ships cannot double-spend
 * what was sent before the table existed; rewording a log line can no longer lower a cap.
 */
export function linkedinActionsToday(db: DB, accountId: string, type: LinkedinActionType, timezone: string): number {
  const day = localDayBoundsUtc(timezone || "UTC");
  const structured = (db.prepare(`SELECT COUNT(*) c FROM linkedin_actions
    WHERE account_id = ? AND type = ? AND status IN ('sending','sent','uncertain') AND created_at >= ? AND created_at < ?`)
    .get(accountId, type, day.start, day.end) as { c: number }).c;
  const legacy = (db.prepare(`SELECT COUNT(*) c FROM logs WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
    AND created_at >= ? AND created_at < ? AND message LIKE ?`)
    .get(accountId, day.start, day.end, LEGACY_LOG_PREFIX[type]) as { c: number }).c;
  return Math.max(structured, legacy);
}

/** Actions of `type` spent this week (Monday 00:00 on the account's calendar onwards). */
export function linkedinActionsThisWeek(db: DB, accountId: string, type: LinkedinActionType, timezone: string, at: Date = new Date()): number {
  return (db.prepare(`SELECT COUNT(*) c FROM linkedin_actions
    WHERE account_id = ? AND type = ? AND status IN ('sending','sent','uncertain') AND created_at >= ?`)
    .get(accountId, type, localWeekStartUtc(timezone || "UTC", at)) as { c: number }).c;
}

/** This week's usage per quota, as the settings drawer shows it (likes count as visits, voice notes as messages). */
export function weeklyUsage(db: DB, accountId: string, timezone: string): { visit: number; connect: number; message: number } {
  const w = (t: LinkedinActionType) => linkedinActionsThisWeek(db, accountId, t, timezone);
  return { visit: w("visit") + w("like"), connect: w("connect"), message: w("message") + w("voice") };
}

interface QuotaLimits {
  daily_connection_limit: number; daily_message_limit: number; daily_visit_limit: number;
  weekly_connection_limit?: number | null; weekly_message_limit?: number | null; weekly_visit_limit?: number | null; timezone: string;
}

/**
 * Lowers today's caps to what the weekly quotas have left: daily = min(daily, sent today +
 * (weekly − sent this week)). Mutates `limits` (one tick's copy). No weekly quota: unchanged.
 */
export function applyWeeklyQuota(db: DB, accountId: string, limits: QuotaLimits, today: { connect: number; message: number; visit: number }): void {
  if (limits.weekly_connection_limit == null && limits.weekly_message_limit == null && limits.weekly_visit_limit == null) return;
  const week = weeklyUsage(db, accountId, limits.timezone);
  const clamp = (daily: number, weekly: number | null | undefined, usedToday: number, usedWeek: number) =>
    weekly == null ? daily : Math.min(daily, usedToday + Math.max(0, weekly - usedWeek));
  limits.daily_connection_limit = clamp(limits.daily_connection_limit ?? 20, limits.weekly_connection_limit, today.connect, week.connect);
  limits.daily_message_limit = clamp(limits.daily_message_limit ?? 50, limits.weekly_message_limit, today.message, week.message);
  limits.daily_visit_limit = clamp(limits.daily_visit_limit ?? 150, limits.weekly_visit_limit, today.visit, week.visit);
}

/**
 * Email sources that spend a mailbox's daily cap: campaign steps plus every one-off send to a
 * prospect (contact thread, team-inbox reply, public API). Warmup, placement tests, test sends
 * and internal notifications are infrastructure traffic with their own budgets.
 */
export const MAILBOX_CAPPED_SOURCES = ["campaign", "contact_thread", "team_inbox", "public_api"] as const;
const CAPPED_SOURCES_SQL = MAILBOX_CAPPED_SOURCES.map((s) => `'${s}'`).join(",");

/**
 * Prospect emails this mailbox has spent today (account timezone): accepted sends from
 * sent_messages plus jobs whose outcome is still open, across every capped source, so manual
 * and campaign sends share one per-mailbox cap. Ground truth, not log text. (The name is kept
 * for its callers; it counts more than campaign sends.)
 */
export function campaignEmailsToday(db: DB, emailAccountId: string, timezone: string): number {
  const day = localDayBoundsUtc(timezone || "UTC");
  const sent = (db.prepare(`SELECT COUNT(*) c FROM sent_messages sm JOIN email_jobs ej ON ej.id = sm.job_id
    WHERE sm.email_account_id = ? AND ej.source IN (${CAPPED_SOURCES_SQL}) AND sm.accepted_at >= ? AND sm.accepted_at < ?`)
    .get(emailAccountId, day.start, day.end) as { c: number }).c;
  const open = (db.prepare(`SELECT COUNT(*) c FROM email_jobs
    WHERE email_account_id = ? AND source IN (${CAPPED_SOURCES_SQL}) AND status IN ('leased','sending','uncertain') AND created_at >= ? AND created_at < ?`)
    .get(emailAccountId, day.start, day.end) as { c: number }).c;
  return sent + open;
}

/** When this mailbox last handed a campaign email to its provider today (SQLite UTC text), if ever. */
export function lastCampaignEmailAt(db: DB, emailAccountId: string, timezone: string): string | null {
  const day = localDayBoundsUtc(timezone || "UTC");
  return (db.prepare(`SELECT MAX(sm.accepted_at) t FROM sent_messages sm JOIN email_jobs ej ON ej.id = sm.job_id
    WHERE sm.email_account_id = ? AND ej.source = 'campaign' AND sm.accepted_at >= ? AND sm.accepted_at < ?`)
    .get(emailAccountId, day.start, day.end) as { t: string | null }).t;
}

// ─── atomic track claims ─────────────────────────────────────────────────────

/** Longer than a step's watchdog budget, so an orphaned step keeps its track until it ends. */
export const TRACK_CLAIM_STALE_MINUTES = 15;

/**
 * Atomically claim a due track for one worker. False when another worker (or an orphaned
 * step that is still running) holds a live claim, or when the track is no longer in progress,
 * due and on `expectedStep` - i.e. someone else already moved it since it was read - so two
 * processes never run the same track, or the same step twice.
 */
export function claimTrack(db: DB, trackId: string, owner: string, expectedStep: number): boolean {
  return db.prepare(`UPDATE run_profile_tracks SET claimed_by = ?, claimed_at = datetime('now')
    WHERE id = ? AND state = 'in_progress' AND current_step = ?
      AND (next_step_at IS NULL OR datetime(next_step_at) <= datetime('now'))
      AND (claimed_by IS NULL OR claimed_at IS NULL OR claimed_at < datetime('now', ?))`)
    .run(owner, trackId, expectedStep, `-${TRACK_CLAIM_STALE_MINUTES} minutes`).changes > 0;
}

export function releaseTrack(db: DB, trackId: string, owner: string): void {
  db.prepare("UPDATE run_profile_tracks SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ?").run(trackId, owner);
}
