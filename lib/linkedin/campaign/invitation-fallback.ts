import type { getDb } from "@/lib/db";
import { CONNECTION_MAX_WAIT_DAYS } from "./constants";
import { hoursSince, log, trSkip } from "./track-state";
import type { TrackRun, WorkflowStep } from "./types";

/**
 * "Skip after N days" on the invitation step: when the contact hasn't accepted after N days,
 * the LinkedIn track (invitation and messages) is skipped and the email track's next step is
 * brought forward to now, so the lead is reached by email right away.
 */

/** "Never skip" still ends here: no lead waits forever on an invitation nobody answers. */
export const ABSOLUTE_MAX_WAIT_DAYS = 60;

/** Days to wait for acceptance, from the track's invitation step (0 = "never" = the 60-day ceiling). */
export function skipAfterDays(steps: WorkflowStep[]): number {
  const connect = steps.find((s) => s.step_type === "connect");
  const days = connect?.skip_after_days ?? CONNECTION_MAX_WAIT_DAYS;
  return days > 0 ? Math.min(days, ABSOLUTE_MAX_WAIT_DAYS) : ABSOLUTE_MAX_WAIT_DAYS;
}

/** True when the invitation sent at `requestedAt` has waited past the step's limit. */
export function invitationExpired(steps: WorkflowStep[], requestedAt: string | null): boolean {
  return !!requestedAt && hoursSince(requestedAt) / 24 > skipAfterDays(steps);
}

/** Skip the LinkedIn track and move this lead's email track up to send now. Returns whether email was brought forward. */
export function skipToEmail(db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, targetId: string, name: string, steps: WorkflowStep[]): boolean {
  const days = skipAfterDays(steps);
  return db.transaction(() => {
    trSkip(db, tr, `Did not accept the invitation within ${days} days`);
    const moved = db.prepare(`UPDATE run_profile_tracks SET next_step_at = datetime('now')
      WHERE run_profile_id = ? AND track = 'email' AND state = 'in_progress' AND (next_step_at IS NULL OR next_step_at > datetime('now'))`).run(tr.run_profile_id).changes > 0;
    log(db, runId, targetId, "warn", `${name} did not accept the invitation within ${days} days — skipping LinkedIn steps${moved ? ", sending the next email now" : ""}`);
    return moved;
  })();
}

/**
 * A message step for someone who isn't connected and has no invitation pending can never send
 * (nothing will make them a connection): skip the LinkedIn steps and bring email forward, instead
 * of rechecking every few hours forever.
 */
export function skipNotConnected(db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, targetId: string, name: string): void {
  db.transaction(() => {
    trSkip(db, tr, "Not connected and no invitation pending");
    const moved = db.prepare(`UPDATE run_profile_tracks SET next_step_at = datetime('now')
      WHERE run_profile_id = ? AND track = 'email' AND state = 'in_progress' AND (next_step_at IS NULL OR next_step_at > datetime('now'))`).run(tr.run_profile_id).changes > 0;
    log(db, runId, targetId, "warn", `${name} is not a connection and no invitation is pending — skipping LinkedIn messages${moved ? ", sending the next email now" : ""}`);
  })();
}
