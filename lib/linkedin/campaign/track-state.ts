import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { branchLandingIndex } from "@/lib/outreach/sequence";
import { evaluateWorkflowConditions, type ConditionGroup } from "@/lib/platform/conditions";
import { isWithinSchedule, nextScheduledSlot } from "./schedule";
import type { ScheduleConfig, TrackRun, WorkflowStep } from "./types";

// ─── helpers ────────────────────────────────────────────────────────────────

export function log(db: ReturnType<typeof getDb>, runId: string, targetId: string | null, level: "info" | "warn" | "error", message: string) {
  db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), runId, targetId, level, message);
  console.log(`[runner] [${level}] run=${runId} target=${targetId ?? "-"} ${message}`);
}

export function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
export function randomDelay(minSec: number, maxSec: number) { return sleep((minSec + Math.random() * (maxSec - minSec)) * 1000); }
export function nowIso() { return new Date().toISOString(); }
export function addHours(h: number) { return new Date(Date.now() + h * 3600_000).toISOString(); }
export function hoursSince(isoStr: string) { return (Date.now() - new Date(isoStr).getTime()) / 3600_000; }

// ─── TrackRun verb layer ─────────────────────────────────────────────────────
// These are the only functions that write to run_profile_tracks rows.

export function trAdvance(db: ReturnType<typeof getDb>, tr: TrackRun, steps: WorkflowStep[]) {
  let nextIndex = tr.current_step + 1;
  const sourceStep = steps[tr.current_step];
  if (sourceStep) {
    const branch = db.prepare("SELECT conditions_json, true_step_id, false_step_id FROM workflow_branches WHERE source_step_id = ?")
      .get(sourceStep.id) as { conditions_json: string; true_step_id: string | null; false_step_id: string | null } | undefined;
    if (branch) {
      try {
        const group = JSON.parse(branch.conditions_json) as ConditionGroup;
        // Only branch on a well-formed, non-empty condition group. A malformed/legacy branch
        // (e.g. missing the conditions array) must NOT silently evaluate as "matched" and
        // misroute — fall through to the next step in order instead.
        if (!Array.isArray(group?.conditions) || group.conditions.length === 0) {
          console.warn(`[runner] Branch on step ${sourceStep.id} has no valid conditions — running steps in order`);
        } else {
          const matched = evaluateWorkflowConditions(db, tr.target_id, group);
          const destination = matched ? branch.true_step_id : branch.false_step_id;
          if (destination) {
            const branchIndex = steps.findIndex((step) => step.id === destination);
            if (branchIndex > tr.current_step) {
              // A branch names an ACTION step, but a sequence models "wait N days, then
              // do X" as [delay(N), X]. Jumping straight to X discards that wait: the
              // destination's own delay_seconds is 0, so the write below sets
              // next_step_at = NULL and the step runs on the very next poll. A
              // reply-gated 5-email sequence therefore collapsed into ~40 minutes,
              // sending every follow-up at once. Land on the delay that guards the
              // destination so the normal wait/advance path applies it. Only walk back
              // over delays that are still ahead of us, preserving forward-only branching.
              nextIndex = branchLandingIndex(steps, tr.current_step, branchIndex);
            }
          }
        }
      } catch (error) {
        console.warn(`[runner] Invalid branch on step ${sourceStep.id}:`, error);
      }
    }
  }
  if (nextIndex >= steps.length) {
    db.prepare(
      "UPDATE run_profile_tracks SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?"
    ).run(nextIndex, tr.id);
  } else {
    const nextStep = steps[nextIndex];
    const nextAt = nextStep.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
    db.prepare(
      "UPDATE run_profile_tracks SET current_step = ?, last_step_at = datetime('now'), next_step_at = ?, retry_count = 0 WHERE id = ?"
    ).run(nextIndex, nextAt, tr.id);
  }
}

export function trWait(db: ReturnType<typeof getDb>, tr: TrackRun, hours: number) {
  db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(addHours(hours), tr.id);
}

export function trReschedule(db: ReturnType<typeof getDb>, tr: TrackRun, isoTimestamp: string) {
  db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(isoTimestamp, tr.id);
}

export function trSkip(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string) {
  db.prepare("UPDATE run_profile_tracks SET state = 'skipped', error_message = ? WHERE id = ?").run(reason, tr.id);
}

export function trFail(db: ReturnType<typeof getDb>, tr: TrackRun, reason: string) {
  db.prepare("UPDATE run_profile_tracks SET state = 'failed', error_message = ? WHERE id = ?").run(reason, tr.id);
}

/** Keep the track on its current step and retry later, with the reason visible on the track. */
export function trHold(db: ReturnType<typeof getDb>, tr: TrackRun, hours: number, reason: string) {
  db.prepare("UPDATE run_profile_tracks SET next_step_at = ?, error_message = ? WHERE id = ?").run(addHours(hours), reason, tr.id);
}

export function trRecordContext(db: ReturnType<typeof getDb>, tr: TrackRun, ctx: { linkedinMessage?: string; emailSubject?: string; emailBody?: string }) {
  if (ctx.linkedinMessage !== undefined) {
    db.prepare("UPDATE run_profile_tracks SET last_linkedin_message = ? WHERE id = ?").run(ctx.linkedinMessage, tr.id);
  }
  if (ctx.emailSubject !== undefined || ctx.emailBody !== undefined) {
    db.prepare("UPDATE run_profile_tracks SET last_email_subject = ?, last_email_body = ? WHERE id = ?")
      .run(ctx.emailSubject ?? null, ctx.emailBody ?? null, tr.id);
  }
}

// ─── enforceSchedule helper ──────────────────────────────────────────────────
// Returns true if the step may proceed. Returns false and reschedules if outside the window.

export function enforceSchedule(
  db: ReturnType<typeof getDb>,
  tr: TrackRun,
  runId: string,
  targetId: string,
  name: string,
  schedule: ScheduleConfig
): boolean {
  if (isWithinSchedule(schedule)) return true;
  const nextSlot = nextScheduledSlot(schedule);
  log(db, runId, targetId, "info", `Outside working schedule — rescheduling ${name} to ${nextSlot}`);
  trReschedule(db, tr, nextSlot);
  return false;
}
