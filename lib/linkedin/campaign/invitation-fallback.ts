import type { getDb } from "@/lib/db";
import { CONNECTION_MAX_WAIT_DAYS } from "./constants";
import { hoursSince, log, trSkip } from "./track-state";
import type { TrackRun, WorkflowStep } from "./types";

/**
 * "Skip after N days" on the invitation step: when the contact hasn't accepted after N days,
 * the LinkedIn track (invitation and messages) is skipped and the email track's next step is
 * brought forward to now, so the lead is reached by email right away.
 */

/** Days to wait for acceptance, from the track's invitation step; null = wait indefinitely. */
export function skipAfterDays(steps: WorkflowStep[]): number | null {
  const connect = steps.find((s) => s.step_type === "connect");
  const days = connect?.skip_after_days ?? CONNECTION_MAX_WAIT_DAYS;
  return days > 0 ? days : null;
}

/** True when the invitation sent at `requestedAt` has waited past the step's limit. */
export function invitationExpired(steps: WorkflowStep[], requestedAt: string | null): boolean {
  const days = skipAfterDays(steps);
  return !!requestedAt && days !== null && hoursSince(requestedAt) / 24 > days;
}

/** Skip the LinkedIn track and move this lead's email track up to send now. Returns whether email was brought forward. */
export function skipToEmail(db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, targetId: string, name: string, steps: WorkflowStep[]): boolean {
  const days = skipAfterDays(steps) ?? CONNECTION_MAX_WAIT_DAYS;
  return db.transaction(() => {
    trSkip(db, tr, `Did not accept the invitation within ${days} days`);
    const moved = db.prepare(`UPDATE run_profile_tracks SET next_step_at = datetime('now')
      WHERE run_profile_id = ? AND track = 'email' AND state = 'in_progress' AND (next_step_at IS NULL OR next_step_at > datetime('now'))`).run(tr.run_profile_id).changes > 0;
    log(db, runId, targetId, "warn", `${name} did not accept the invitation within ${days} days — skipping LinkedIn steps${moved ? ", sending the next email now" : ""}`);
    return moved;
  })();
}
