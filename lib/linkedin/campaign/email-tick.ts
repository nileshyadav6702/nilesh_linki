import { getDb } from "@/lib/db";
import { WORKER_ID } from "@/lib/email/infrastructure";
import { claimTrack, releaseTrack } from "@/lib/linkedin/actions";
import { guard } from "@/lib/watchdog";
import { EMAIL_TICK_SOFT_BUDGET_MS, EXECUTE_STEP_TIMEOUT_MS } from "./constants";
import { isStopping } from "@/lib/runtime/lifecycle";
import { effectiveEmailLimit, rescheduleToTomorrow } from "./schedule";
import { log, trFail } from "./track-state";
import {
  completeFinishedRuns, dueTracks, emailAccountsForRuns, emailCampaignRuns, emailFallbackLimits, emailsSentTodayFor,
  enrollPendingEmailTracks, heartbeat, strandedRunningRunIds,
} from "./runs";
import { executeStep } from "./steps";
import type { ScheduleConfig, Target, TrackRun, WorkflowStep } from "./types";

/**
 * Drive email tracks without a LinkedIn session. Sends stay on the durable email job
 * path inside executeStep; this loop only decides which email step is due. It does not
 * open a browser and does not wait the 8–20s gap the LinkedIn loop leaves between profiles.
 */
export async function emailCampaignTick(db: ReturnType<typeof getDb>): Promise<void> {
  completeFinishedRuns(db, strandedRunningRunIds(db));
  const activeRuns = emailCampaignRuns(db);
  if (activeRuns.length === 0) return;

  heartbeat(db, activeRuns);

  const runIds = activeRuns.map((run) => run.run_id);
  const emailLimitsByAccount = emailAccountsForRuns(db, runIds);
  const sentToday = new Map<string, number>();
  for (const [emailAccountId, limits] of emailLimitsByAccount) {
    sentToday.set(emailAccountId, emailsSentTodayFor(db, emailAccountId, limits.timezone || "UTC"));
  }

  const stepsCache = new Map<string, WorkflowStep[]>();
  const getSteps = (workflowId: string, track: string): WorkflowStep[] => {
    const key = `${workflowId}|${track}`;
    if (!stepsCache.has(key)) {
      stepsCache.set(key, db.prepare(
        "SELECT * FROM workflow_steps WHERE workflow_id = ? AND track = ? ORDER BY step_order"
      ).all(workflowId, track) as WorkflowStep[]);
    }
    return stepsCache.get(key)!;
  };
  const workflowPromptCache = new Map<string, string | null>();
  const getWorkflowPrompt = (workflowId: string): string | null => {
    if (!workflowPromptCache.has(workflowId)) {
      const row = db.prepare("SELECT prompt FROM workflows WHERE id = ?").get(workflowId) as { prompt: string | null } | undefined;
      workflowPromptCache.set(workflowId, row?.prompt ?? null);
    }
    return workflowPromptCache.get(workflowId) ?? null;
  };

  const enrolled = new Set<string>();
  for (const run of activeRuns) {
    const accountIds = (db.prepare(
      `SELECT DISTINCT rp.email_account_id FROM run_profiles rp
       WHERE rp.run_id = ? AND rp.email_account_id IS NOT NULL`
    ).all(run.run_id) as Array<{ email_account_id: string }>).map((row) => row.email_account_id);
    for (const emailAccountId of accountIds) {
      const key = `${run.run_id}|${emailAccountId}`;
      if (enrolled.has(key)) continue;
      enrolled.add(key);
      const limits = emailLimitsByAccount.get(emailAccountId);
      if (limits) enrollPendingEmailTracks(db, run.run_id, emailAccountId, limits, sentToday.get(emailAccountId) ?? 0);
    }
  }

  const due = dueTracks(db, runIds, "email");
  const toExecute: TrackRun[] = [];
  const toReschedule: Array<{ tr: TrackRun; schedule: ScheduleConfig }> = [];
  const planned = new Map<string, number>();

  for (const tr of due) {
    const steps = getSteps(tr.workflow_id, tr.track);
    const step = steps[tr.current_step];
    if (!step || step.step_type !== "email") {
      toExecute.push(tr);
      continue;
    }
    const emailAccountId = tr.email_account_id;
    if (!emailAccountId) {
      toExecute.push(tr);
      continue;
    }
    const limits = emailLimitsByAccount.get(emailAccountId);
    const already = (sentToday.get(emailAccountId) ?? 0) + (planned.get(emailAccountId) ?? 0);
    const cap = limits ? effectiveEmailLimit(limits) : 50;
    if (already >= cap) {
      toReschedule.push({ tr, schedule: limits ?? emailFallbackLimits(null) });
    } else {
      planned.set(emailAccountId, (planned.get(emailAccountId) ?? 0) + 1);
      toExecute.push(tr);
    }
  }

  for (const { tr, schedule } of toReschedule) {
    const slot = rescheduleToTomorrow(schedule);
    db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(slot, tr.id);
    log(db, tr.run_id, tr.target_id, "warn", `Daily email limit reached — rescheduled to ${slot}`);
  }

  const deadline = Date.now() + EMAIL_TICK_SOFT_BUDGET_MS;
  let executed = 0;
  for (const tr of toExecute) {
    if (Date.now() > deadline) {
      console.log(`[runner] Email tick soft budget reached — ${executed}/${toExecute.length} steps done, remainder stays due`);
      break;
    }
    // Graceful shutdown: the step in flight finished; start no new one.
    if (isStopping()) {
      console.log(`[runner] Email tick stopping for shutdown — ${executed}/${toExecute.length} steps done, remainder stays due`);
      break;
    }
    const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(tr.run_id) as { status: string } | undefined;
    if (!runStatus || runStatus.status !== "running") continue;

    const steps = getSteps(tr.workflow_id, tr.track);
    const step = steps[tr.current_step];
    if (step && step.step_type !== "email" && step.step_type !== "delay") {
      log(db, tr.run_id, tr.target_id, "error", `Email worker refused a ${step.step_type} step on the email track`);
      trFail(db, tr, `Email track cannot run a ${step.step_type} step`);
      continue;
    }

    const emailAccountId = tr.email_account_id ?? null;
    const emailLimits = emailAccountId ? (emailLimitsByAccount.get(emailAccountId) ?? null) : null;
    const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(tr.target_id) as Target;
    // Atomic claim: another process (or a still-running orphaned step) may already have it.
    if (!claimTrack(db, tr.id, WORKER_ID, tr.current_step)) continue;
    await guard(
      `Email step for target ${tr.target_id}`,
      EXECUTE_STEP_TIMEOUT_MS,
      async () => {
        try {
          await executeStep(
            db, tr.run_id, tr, target, steps,
            tr.account_id || "",
            emailFallbackLimits(emailLimits),
            emailAccountId,
            emailLimits,
            getWorkflowPrompt(tr.workflow_id),
          );
        } finally {
          // Released when the step really ends — an abandoned (timed-out) step keeps its claim.
          releaseTrack(db, tr.id, WORKER_ID);
        }
      },
      (err) => log(db, tr.run_id, tr.target_id, "error", `Email step aborted: ${err.message}`),
    );
    executed += 1;
    heartbeat(db, activeRuns);
  }

  completeFinishedRuns(db, runIds);
}
