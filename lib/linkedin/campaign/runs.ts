import { getDb } from "@/lib/db";
import { campaignEmailsToday } from "@/lib/linkedin/actions";
import { emitDomainEvent } from "@/lib/platform/events";
import { localDayBoundsUtc, zonedParts, zonedTimeToUtcMs } from "@/lib/outreach/schedule";
import { effectiveEmailLimit, getLocalParts, rescheduleToTomorrow } from "./schedule";
import { log } from "./track-state";
import type { AccountLimits, EmailAccountLimits, ScheduleConfig, TrackRun } from "./types";

// Run selection, heartbeat, enrollment and completion — the DB side of a tick.

/**
 * Stamp the runner heartbeat on the given runs.
 *
 * Called at the top of every tick AND again after each profile the tick processes. Stamping
 * only at the top was not enough: a tick legitimately runs for minutes while it drains a
 * backlog (up to EXECUTE_STEP_TIMEOUT_MS per step, plus the human-like delay between
 * profiles), so a single stamp made a busy runner look stalled. The heartbeat has to track
 * progress through the tick, not just its start, or the stalled indicator cries wolf on
 * exactly the workload it matters most during.
 */
export function heartbeat(db: ReturnType<typeof getDb>, runs: Array<{ run_id: string }>): void {
  const stmt = db.prepare("UPDATE runs SET runner_pid = ?, last_tick_at = datetime('now') WHERE id = ?");
  for (const run of runs) {
    try { stmt.run(process.pid, run.run_id); } catch { /* non-fatal bookkeeping */ }
  }
}

export interface CampaignRunRef {
  run_id: string;
  workflow_id: string;
  account_id: string | null;
  email_account_id: string | null;
}

/** Runs the LinkedIn loop will drive. A logged-out session is invisible here on purpose. */
export function linkedInCampaignRuns(db: ReturnType<typeof getDb>): Array<CampaignRunRef & AccountLimits> {
  return db.prepare(`
    SELECT r.id as run_id, r.workflow_id, r.account_id, r.email_account_id,
           a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit, a.daily_visit_limit,
           a.active_hours_start, a.active_hours_end, a.timezone, a.working_days
    FROM runs r
    JOIN accounts a ON a.id = r.account_id
    WHERE r.status = 'running' AND a.is_authenticated = 1
  `).all() as Array<CampaignRunRef & AccountLimits>;
}

/**
 * Runs the email loop will drive. Any open email track qualifies, including a run
 * with no LinkedIn account and a run whose LinkedIn session is logged out.
 */
export function emailCampaignRuns(db: ReturnType<typeof getDb>): CampaignRunRef[] {
  return db.prepare(`
    SELECT DISTINCT r.id as run_id, r.workflow_id, r.account_id, r.email_account_id
    FROM runs r
    JOIN run_profiles rp ON rp.run_id = r.id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE r.status = 'running'
      AND rt.track = 'email'
      AND rt.state NOT IN ('completed', 'failed', 'skipped')
  `).all() as CampaignRunRef[];
}

export function dueTracks(db: ReturnType<typeof getDb>, runIds: string[], track: "linkedin" | "email"): TrackRun[] {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => "?").join(",");
  return db.prepare(
    `SELECT rt.id, rt.run_profile_id, rt.track, rt.state, rt.current_step, rt.next_step_at,
            rt.error_message, rt.last_email_subject, rt.last_email_body, rt.last_linkedin_message,
            rt.pending_reply_context,
            rp.run_id, rp.target_id, rp.email_account_id,
            r.account_id, r.workflow_id,
            t.connection_requested_at
     FROM run_profile_tracks rt
     JOIN run_profiles rp ON rp.id = rt.run_profile_id
     JOIN runs r ON r.id = rp.run_id
     JOIN targets t ON t.id = rp.target_id
     WHERE rp.run_id IN (${placeholders})
       AND rt.track = ?
       AND rt.state = 'in_progress'
       AND (rt.next_step_at IS NULL OR datetime(rt.next_step_at) <= datetime('now'))
     ORDER BY rt.next_step_at ASC`
  ).all(...runIds, track) as TrackRun[];
}

export function completeFinishedRuns(db: ReturnType<typeof getDb>, runIds: string[]): void {
  for (const runId of runIds) {
    const remaining = (db.prepare(
      `SELECT COUNT(*) as c FROM run_profile_tracks rt
       JOIN run_profiles rp ON rp.id = rt.run_profile_id
       WHERE rp.run_id = ? AND rt.state NOT IN ('completed', 'failed', 'skipped')`
    ).get(runId) as { c: number }).c;
    if (remaining !== 0) continue;
    const profiles = (db.prepare("SELECT COUNT(*) as c FROM run_profiles WHERE run_id = ?").get(runId) as { c: number }).c;
    if (profiles === 0) continue;
    const updated = db.prepare("UPDATE runs SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND status = 'running'").run(runId);
    if (updated.changes === 0) continue;
    const completedRun = db.prepare("SELECT workspace_id, workflow_id FROM runs WHERE id = ?").get(runId) as { workspace_id: string; workflow_id: string } | undefined;
    if (completedRun) emitDomainEvent({ workspaceId: completedRun.workspace_id, type: "workflow.completed", entityType: "run", entityId: runId, payload: { workflow_id: completedRun.workflow_id } });
    log(db, runId, null, "info", "All profiles processed — run completed");
  }
}

/** Running runs whose every track is already terminal. Closes a run the worker that finished the last step did not get to mark. */
export function strandedRunningRunIds(db: ReturnType<typeof getDb>): string[] {
  return (db.prepare(`
    SELECT r.id FROM runs r
    WHERE r.status = 'running'
      AND EXISTS (SELECT 1 FROM run_profiles rp WHERE rp.run_id = r.id)
      AND NOT EXISTS (
        SELECT 1 FROM run_profile_tracks rt
        JOIN run_profiles rp ON rp.id = rt.run_profile_id
        WHERE rp.run_id = r.id AND rt.state NOT IN ('completed', 'failed', 'skipped')
      )
  `).all() as Array<{ id: string }>).map((row) => row.id);
}

export function emailAccountsForRuns(db: ReturnType<typeof getDb>, runIds: string[]): Map<string, EmailAccountLimits> {
  const limits = new Map<string, EmailAccountLimits>();
  if (runIds.length === 0) return limits;
  const placeholders = runIds.map(() => "?").join(",");
  const ids = (db.prepare(
    `SELECT DISTINCT rp.email_account_id FROM run_profiles rp
     WHERE rp.run_id IN (${placeholders}) AND rp.email_account_id IS NOT NULL`
  ).all(...runIds) as Array<{ email_account_id: string }>).map((row) => row.email_account_id);
  for (const emailAccountId of ids) {
    const account = db.prepare(
      "SELECT daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, ramp_up_enabled, ramp_start_date FROM email_accounts WHERE id = ?"
    ).get(emailAccountId) as EmailAccountLimits | undefined;
    if (account) limits.set(emailAccountId, account);
  }
  return limits;
}

/** Structured count (sent_messages + open jobs), not log text — see lib/linkedin/actions.ts. */
export function emailsSentTodayFor(db: ReturnType<typeof getDb>, emailAccountId: string, timezone: string): number {
  return campaignEmailsToday(db, emailAccountId, timezone);
}

export function enrollPendingEmailTracks(
  db: ReturnType<typeof getDb>,
  runId: string,
  emailAccountId: string,
  limits: EmailAccountLimits,
  sentToday: number,
): void {
  const emailsLeft = Math.max(0, effectiveEmailLimit(limits) - sentToday);
  // "Today" on the mailbox's calendar, like the cap it is checked against (was UTC date('now')).
  const day = localDayBoundsUtc(limits.timezone || "UTC");
  const scheduledToday = (db.prepare(
    `SELECT COUNT(*) as c FROM run_profile_tracks rt
     JOIN run_profiles rp ON rp.id = rt.run_profile_id
     WHERE rp.email_account_id = ? AND rt.track = 'email' AND rt.state = 'in_progress'
     AND datetime(rt.next_step_at) >= ? AND datetime(rt.next_step_at) < ?`
  ).get(emailAccountId, day.start, day.end) as { c: number }).c;
  const slotsLeft = Math.max(0, emailsLeft - scheduledToday);
  if (slotsLeft <= 0) return;
  const pending = db.prepare(
    `SELECT rt.id, rt.run_profile_id, rt.track FROM run_profile_tracks rt
     JOIN run_profiles rp ON rp.id = rt.run_profile_id
     WHERE rp.run_id = ? AND rp.email_account_id = ? AND rt.track = 'email' AND rt.state = 'pending'
     ORDER BY rt.id LIMIT ?`
  ).all(runId, emailAccountId, Math.min(slotsLeft, 5)) as Array<{ id: string; run_profile_id: string; track: string }>;
  spreadEnrollBatch(db, runId, pending, limits, "email");
}

export function emailFallbackLimits(emailLimits: EmailAccountLimits | null): AccountLimits {
  return {
    daily_connection_limit: 0,
    daily_message_limit: 0,
    daily_inmail_limit: 0,
    daily_visit_limit: 0,
    active_hours_start: emailLimits?.active_hours_start ?? 9,
    active_hours_end: emailLimits?.active_hours_end ?? 18,
    timezone: emailLimits?.timezone || "UTC",
    working_days: emailLimits?.working_days || "1,2,3,4,5",
  };
}

export function spreadEnrollBatch(
  db: ReturnType<typeof getDb>,
  runId: string,
  pending: Array<{ id: string; run_profile_id: string; track: string }>,
  limits: ScheduleConfig,
  track: string
) {
  const batchSize = pending.length;
  if (batchSize === 0) return;
  const start = limits.active_hours_start ?? 9;
  const end = limits.active_hours_end ?? 18;
  const tz = limits.timezone || "UTC";
  const { hour, minute } = getLocalParts(tz);
  const nowFrac = hour + minute / 60;
  // Window bounds in the ACCOUNT's timezone (previously server-local, so on a UTC host
  // with a non-UTC account the buckets landed outside the account's real window).
  const { year, month, day } = zonedParts(tz);
  const dayStartMs = zonedTimeToUtcMs(tz, year, month, day, start);
  const dayEndMs = zonedTimeToUtcMs(tz, year, month, day, end);
  // Spread over what is LEFT of the window. Anchoring at the window start meant every
  // bucket before "now" was already due, so a whole enrolment batch fired at once.
  const spreadFrom = Math.max(dayStartMs, Date.now());
  const bucketMs = Math.max(0, dayEndMs - spreadFrom) / batchSize;

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const claimed = db.prepare(
      "UPDATE run_profile_tracks SET state = 'in_progress' WHERE id = ? AND state = 'pending'"
    ).run(row.id);
    if (claimed.changes === 0) continue;
    const slot = (() => {
      if (nowFrac >= end - 0.25) return rescheduleToTomorrow(limits);
      const bucketStart = spreadFrom + i * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      return new Date(bucketStart + Math.random() * (bucketEnd - bucketStart)).toISOString();
    })();
    db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(slot, row.id);
    const tgt = db.prepare("SELECT full_name, linkedin_url FROM targets WHERE id = (SELECT target_id FROM run_profiles WHERE id = ?)").get(row.run_profile_id) as { full_name: string | null; linkedin_url: string } | undefined;
    log(db, runId, null, "info", `[${track}] Scheduled ${tgt?.full_name ?? tgt?.linkedin_url ?? row.run_profile_id} within active window`);
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

export function startRun(runId: string): void {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  console.log(`[runner] Run ${runId} marked running — global loop will pick it up`);
}
