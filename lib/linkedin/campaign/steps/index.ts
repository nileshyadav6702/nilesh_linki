import { getDb } from "@/lib/db";
import { WeeklyLimitError, AlreadyConnectedError, PendingInviteError } from "@/lib/linkedin/connect";
import { SenderPausedError, RecipientSuppressedError } from "@/lib/email/infrastructure";
import { isAiBlockingError } from "@/lib/ai/client";
import { findTargetSuppression } from "@/lib/platform/suppression";
import { CONNECTION_RECHECK_HOURS } from "../constants";
import { holdForAi } from "../step-helpers";
import { log, nowIso, trAdvance, trFail, trSkip, trWait } from "../track-state";
import type { AccountLimits, EmailAccountLimits, Target, TrackRun, WorkflowStep } from "../types";
import type { StepContext } from "./context";
import { runVisitStep } from "./visit";
import { runConnectStep } from "./connect";
import { runMessageStep } from "./message";
import { runInmailStep } from "./inmail";
import { runEmailStep } from "./email";

// ─── step execution ──────────────────────────────────────────────────────────

export async function executeStep(
  db: ReturnType<typeof getDb>,
  runId: string,
  tr: TrackRun,
  target: Target,
  steps: WorkflowStep[],
  accountId: string,
  accountLimits: AccountLimits,
  emailAccountId?: string | null,
  emailAccountLimits?: EmailAccountLimits | null,
  campaignPrompt?: string | null
): Promise<void> {
  const stepIndex = tr.current_step;
  if (stepIndex >= steps.length) {
    db.prepare("UPDATE run_profile_tracks SET state = 'completed', last_step_at = datetime('now') WHERE id = ?").run(tr.id);
    return;
  }

  const suppression = findTargetSuppression(target.workspace_id, target.id);
  if (suppression) {
    log(db, runId, target.id, "warn", `${target.full_name ?? target.linkedin_url} is suppressed (${suppression.kind}: ${suppression.reason}) — unenrolling`);
    db.prepare("UPDATE run_profile_tracks SET state = 'skipped', error_message = ? WHERE run_profile_id = ? AND state NOT IN ('completed','failed','skipped')")
      .run(`Suppressed: ${suppression.reason}`, tr.run_profile_id);
    return;
  }

  // Auto-unenroll if lead has replied on either channel — mark ALL track-runs for this profile skipped
  const replyCheck = db.prepare("SELECT last_replied_at, email_replied_at FROM targets WHERE id = ?").get(target.id) as { last_replied_at: string | null; email_replied_at: string | null };
  if (replyCheck?.last_replied_at || replyCheck?.email_replied_at) {
    const channel = replyCheck.email_replied_at ? "email" : "LinkedIn";
    log(db, runId, target.id, "info", `${target.full_name ?? target.linkedin_url} replied via ${channel} — unenrolling from workflow`);
    db.prepare(
      "UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Lead replied' WHERE run_profile_id = ? AND state NOT IN ('completed', 'failed', 'skipped')"
    ).run(tr.run_profile_id);
    return;
  }

  const step = steps[stepIndex];
  const name = target.full_name ?? target.linkedin_url;
  const ctx: StepContext = {
    db, runId, tr, target, steps, step, name, accountId, accountLimits, emailAccountId, emailAccountLimits, campaignPrompt,
  };

  try {
    switch (step.step_type) {
      case "delay":
        trAdvance(db, tr, steps);
        log(db, runId, target.id, "info", `Delay step passed for ${name}`);
        return;
      case "visit": return await runVisitStep(ctx);
      case "connect": return await runConnectStep(ctx);
      case "message": return await runMessageStep(ctx);
      case "sales_inmail": return await runInmailStep(ctx);
      case "email": return await runEmailStep(ctx);
    }
  } catch (err) {
    handleStepError(db, runId, tr, target, steps, name, err);
  }
}

/** Map a thrown step error to the track transition it calls for. */
function handleStepError(
  db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, target: Target, steps: WorkflowStep[], name: string, err: unknown,
): void {
  const msg = err instanceof Error ? err.message : String(err);
  // AI writing is blocked on the user (key rejected, out of credit, spend cap): hold the
  // step and retry later. Skipping it would "complete" the track with nothing sent.
  if (isAiBlockingError(err)) {
    holdForAi(db, runId, tr, target.id, name, msg);
    return;
  }
  if (err instanceof WeeklyLimitError) {
    log(db, runId, target.id, "error", `Weekly connection limit reached — pausing run`);
    db.prepare("UPDATE runs SET status = 'paused' WHERE id = ?").run(runId);
    return;
  }
  if (err instanceof AlreadyConnectedError) {
    log(db, runId, target.id, "info", `${name} already connected — advancing`);
    db.prepare("UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?").run(nowIso(), target.id);
    trAdvance(db, tr, steps);
    return;
  }
  if (err instanceof PendingInviteError) {
    log(db, runId, target.id, "info", `${name} invite already pending — will recheck`);
    if (!target.connection_requested_at) db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
    trWait(db, tr, CONNECTION_RECHECK_HOURS);
    return;
  }
  // The mailbox is paused — manually, or by the bounce/complaint policy. That says nothing
  // about this contact, so the track is HELD rather than failed. Failing it burned contacts
  // (they never get a later attempt) for a condition that clears as soon as the mailbox is
  // resumed, and it read as a per-contact send error in the run log, which is misleading.
  if (err instanceof SenderPausedError) {
    log(db, runId, target.id, "warn", `Sending mailbox is paused (${msg}) — holding ${name} until it resumes`);
    trWait(db, tr, 1);
    return;
  }
  // On the do-not-send list. Permanent for this channel, but it is a deliberate exclusion,
  // not a failure — 'skipped' is what the UI and analytics read as "we chose not to send".
  if (err instanceof RecipientSuppressedError) {
    log(db, runId, target.id, "warn", `${name} is suppressed (${msg}) — unenrolling email track`);
    trSkip(db, tr, msg);
    return;
  }
  log(db, runId, target.id, "error", `Error on ${name}: ${msg}`);
  trFail(db, tr, msg);
}
