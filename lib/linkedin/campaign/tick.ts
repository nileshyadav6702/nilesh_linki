import { getDb } from "@/lib/db";
import { WORKER_ID, type ActiveLease } from "@/lib/email/infrastructure";
import { shouldSyncAccepted, syncAcceptedConnections } from "@/lib/linkedin/sync-accepted";
import { markTrackActionsUncertain, recoverStaleLinkedinActions, linkedinActionsToday, claimTrack, releaseTrack, applyWeeklyQuota } from "@/lib/linkedin/actions";
import { premium } from "@/lib/premium";
import { localDayBoundsUtc } from "@/lib/outreach/schedule";
import { guard, WatchdogTimeoutError } from "@/lib/watchdog";
import {
  ACCEPTED_SYNC_TIMEOUT_MS, EXECUTE_STEP_TIMEOUT_MS, PROFILE_DELAY_MAX, PROFILE_DELAY_MIN, REPLY_SYNC_TIMEOUT_MS, TICK_SOFT_BUDGET_MS,
} from "./constants";
import { rescheduleToTomorrow } from "./schedule";
import { log, randomDelay } from "./track-state";
import { completeFinishedRuns, dueTracks, heartbeat, linkedInCampaignRuns, spreadEnrollBatch } from "./runs";
import { executeStep } from "./steps";
import type { AccountLimits, ScheduleConfig, Target, TrackRun, WorkflowStep } from "./types";

/**
 * One LinkedIn campaign pass. With `accountId` it covers only that account's runs — the
 * per-account worker's unit of work (account-workers.ts); without it, every account in turn.
 * All caps, counters and enrollment budgets are per account either way.
 */
export async function tick(db: ReturnType<typeof getDb>, lease?: ActiveLease, accountId?: string): Promise<void> {
  // Fencing: every phase that mutates track state first checks this pass still owns the
  // LinkedIn lease. A pass that lost it (stalled past the TTL, another process took over)
  // stops instead of racing the new holder.
  const leaseLost = () => !!lease && !lease.isHeld();
  // Account workers recover stale actions once per pass, before any of them starts.
  if (!accountId) recoverStaleLinkedinActions(db);
  const activeRuns = linkedInCampaignRuns(db).filter((run) => !accountId || run.account_id === accountId);

  if (activeRuns.length === 0) return;

  // Liveness FIRST, before any network I/O. runs.runner_pid existed but nothing ever wrote
  // it; then it was written after an unbounded IMAP sync, so a wedged loop still reported a
  // null pid and an orphaned run stayed indistinguishable from a supervised one. Stamped
  // here, pid + last_tick_at are a true heartbeat: if they stop advancing, the loop is stuck,
  // and that is now visible instead of silent.
  heartbeat(db, activeRuns);

  console.log(`[runner] Tick — ${activeRuns.length} active run(s)`);

  const seenAccounts = new Set<string>();
  for (const run of activeRuns) {
    if (!run.account_id || seenAccounts.has(run.account_id)) continue;
    seenAccounts.add(run.account_id);
  }

  // Daily sync: stamp accepted connections from invitation manager (once per 23h per account).
  // Drives a browser, so it gets a deadline — a hung navigation here used to sit between the
  // heartbeat and the work that actually sends.
  for (const accountId of seenAccounts) {
    if (shouldSyncAccepted(accountId)) {
      console.log(`[runner] Starting accepted-connections sync for account ${accountId}`);
      await guard(`Accepted-connections sync (${accountId})`, ACCEPTED_SYNC_TIMEOUT_MS, async () => {
        const stamped = await syncAcceptedConnections(accountId);
        if (stamped > 0) {
          for (const r of activeRuns.filter(x => x.account_id === accountId)) {
            log(db, r.run_id, null, "info", `Accepted-connections sync: ${stamped} contact${stamped === 1 ? "" : "s"} marked as connected`);
          }
        }
        console.log(`[runner] Accepted-connections sync complete — ${stamped} stamped`);
      });
    }
  }

  // LinkedIn inbox reply detection (messaging GraphQL) — once per 15min per
  // account. Sets targets.last_replied_at so the runner auto-unenrolls repliers.
  // LinkedIn reply detection runs only when a reply processor is configured.
  for (const accountId of seenAccounts) {
    if (premium?.replies?.shouldSyncInbox(accountId)) {
      console.log(`[runner] Starting LinkedIn inbox sync for account ${accountId}`);
      await guard(`LinkedIn inbox sync (${accountId})`, REPLY_SYNC_TIMEOUT_MS, async () => {
        const replies = await premium!.replies!.syncAccountInbox(accountId);
        console.log(`[runner] LinkedIn inbox sync complete — ${replies} new repl${replies === 1 ? "y" : "ies"}`);
        if (replies > 0) {
          for (const r of activeRuns.filter(x => x.account_id === accountId)) {
            log(db, r.run_id, null, "info", `LinkedIn inbox sync: ${replies} new repl${replies === 1 ? "y" : "ies"} detected`);
          }
        }
      });
    }
  }

  completeFinishedRuns(db, activeRuns.map((run) => run.run_id));

  // Re-load active runs after potential completions
  const stillActive = db.prepare(`
    SELECT r.id as run_id, r.workflow_id, r.account_id, r.email_account_id,
           a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit, a.daily_visit_limit,
           a.weekly_connection_limit, a.weekly_message_limit, a.weekly_visit_limit,
           a.active_hours_start, a.active_hours_end, a.timezone, a.working_days
    FROM runs r
    JOIN accounts a ON a.id = r.account_id
    WHERE r.status = 'running' AND (? IS NULL OR r.account_id = ?)
  `).all(accountId ?? null, accountId ?? null) as Array<{ run_id: string; workflow_id: string; account_id: string; email_account_id: string | null } & AccountLimits>;

  if (stillActive.length === 0) return;

  const accountLimitsMap = new Map<string, AccountLimits>();
  for (const run of stillActive) {
    if (!accountLimitsMap.has(run.account_id)) accountLimitsMap.set(run.account_id, run);
  }

  // Count actions already done today per LinkedIn account — messages and InMail are
  // counted separately so a busy message quota never starves InMail sends (and vice versa).
  const connectsSentToday = new Map<string, number>();
  const messagesSentToday = new Map<string, number>();
  const inmailsSentToday = new Map<string, number>();
  const visitsSentToday = new Map<string, number>();
  // Counted over the ACCOUNT's calendar day, not the server's UTC day. A UTC boundary that
  // falls inside the working window (17:00 for a Los Angeles account) reset every cap an
  // hour before the window closed, letting a second full quota out in that last hour.
  // Counted from linkedin_actions (claimed before every send), not by matching log wording.
  for (const [accountId, accountLimits] of accountLimitsMap) {
    const tz = accountLimits.timezone;
    connectsSentToday.set(accountId, linkedinActionsToday(db, accountId, "connect", tz));
    messagesSentToday.set(accountId, linkedinActionsToday(db, accountId, "message", tz) + linkedinActionsToday(db, accountId, "voice", tz));
    inmailsSentToday.set(accountId, linkedinActionsToday(db, accountId, "inmail", tz));
    // Likes share the visit cap; voice notes share the message cap.
    visitsSentToday.set(accountId, linkedinActionsToday(db, accountId, "visit", tz) + linkedinActionsToday(db, accountId, "like", tz));
    // A weekly quota (Settings → LinkedIn seat) caps today at what is left of the week.
    applyWeeklyQuota(db, accountId, accountLimits, { connect: connectsSentToday.get(accountId) ?? 0, message: messagesSentToday.get(accountId) ?? 0, visit: visitsSentToday.get(accountId) ?? 0 });
  }

  // Steps cache: (workflow_id, track) → steps filtered by that track
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

  // Workflow prompt cache: workflow_id → campaign prompt string (or null)
  const workflowPromptCache = new Map<string, string | null>();
  const getWorkflowPrompt = (workflowId: string): string | null => {
    if (!workflowPromptCache.has(workflowId)) {
      const row = db.prepare("SELECT prompt FROM workflows WHERE id = ?").get(workflowId) as { prompt: string | null } | undefined;
      workflowPromptCache.set(workflowId, row?.prompt ?? null);
    }
    return workflowPromptCache.get(workflowId) ?? null;
  };

  // Email tracks are claimed by emailCampaignTick, never here. A due email step must
  // not wait on this browser loop, and this loop must not send it twice.
  const dueTrackRuns = dueTracks(db, stillActive.map(r => r.run_id), "linkedin");

  // Enroll new pending track-runs — track remaining slots per account across runs.
  // Enrollment (pending -> in_progress) happens exactly once per track-run, on its
  // FIRST linkedin-track step, so the budget it draws from must match that step's
  // type — a workflow can open on "connect" (e.g. connect -> message) or on
  // "sales_inmail" (e.g. an InMail-first campaign), and each type has its own daily cap.
  const connectSlotsRemaining = new Map<string, number>();
  const inmailSlotsRemaining = new Map<string, number>();
  const firstLinkedinStepCache = new Map<string, string | undefined>();
  const getFirstLinkedinStepType = (workflowId: string): string | undefined => {
    if (!firstLinkedinStepCache.has(workflowId)) {
      const row = db.prepare(
        "SELECT step_type FROM workflow_steps WHERE workflow_id = ? AND track = 'linkedin' ORDER BY step_order LIMIT 1"
      ).get(workflowId) as { step_type: string } | undefined;
      firstLinkedinStepCache.set(workflowId, row?.step_type);
    }
    return firstLinkedinStepCache.get(workflowId);
  };
  if (leaseLost()) { console.warn("[runner] LinkedIn lease lost — ending tick before enrollment"); return; }
  for (const run of stillActive) {
    const limits = accountLimitsMap.get(run.account_id)!;
    const firstStepType = getFirstLinkedinStepType(run.workflow_id);
    const isInmailFirst = firstStepType === "sales_inmail";
    const slotsRemaining = isInmailFirst ? inmailSlotsRemaining : connectSlotsRemaining;

    // LinkedIn track enrollment — each run gets its own enrollment, but all runs
    // for the same account share the daily slot budget for that action type
    if (!slotsRemaining.has(run.account_id)) {
      const dailyLimit = isInmailFirst ? (limits.daily_inmail_limit ?? 15) : (limits.daily_connection_limit ?? 20);
      const sentToday = isInmailFirst
        ? (inmailsSentToday.get(run.account_id) ?? 0)
        : (connectsSentToday.get(run.account_id) ?? 0);
      const actionsLeft = Math.max(0, dailyLimit - sentToday);
      const firstStepTypeSql = isInmailFirst ? "'sales_inmail'" : "'connect'";
      // Same account-local day as the cap (this compared against UTC date('now')).
      const enrollDay = localDayBoundsUtc(limits.timezone || "UTC");
      const scheduledToday = (db.prepare(
        `SELECT COUNT(*) as c FROM run_profile_tracks rt
         JOIN run_profiles rp ON rp.id = rt.run_profile_id
         JOIN runs r ON r.id = rp.run_id
         JOIN workflow_steps ws ON ws.workflow_id = r.workflow_id AND ws.track = 'linkedin' AND ws.step_order = 1
         WHERE r.account_id = ? AND rt.track = 'linkedin' AND rt.state = 'in_progress'
         AND ws.step_type = ${firstStepTypeSql}
         AND datetime(rt.next_step_at) >= ? AND datetime(rt.next_step_at) < ?`
      ).get(run.account_id, enrollDay.start, enrollDay.end) as { c: number }).c;
      slotsRemaining.set(run.account_id, Math.max(0, actionsLeft - scheduledToday));
    }
    const slotsLeft = slotsRemaining.get(run.account_id)!;
    if (slotsLeft > 0) {
      const toEnroll = Math.min(slotsLeft, 5);
      const pending = db.prepare(
        `SELECT rt.id, rt.run_profile_id, rt.track FROM run_profile_tracks rt
         JOIN run_profiles rp ON rp.id = rt.run_profile_id
         WHERE rp.run_id = ? AND rt.track = 'linkedin' AND rt.state = 'pending'
         ORDER BY rt.id LIMIT ?`
      ).all(run.run_id, toEnroll) as Array<{ id: string; run_profile_id: string; track: string }>;
      spreadEnrollBatch(db, run.run_id, pending, limits, "linkedin");
      slotsRemaining.set(run.account_id, slotsLeft - pending.length);
    }
  }

  if (dueTrackRuns.length === 0) return;

  // Apply daily limits — separate due track-runs into execute vs reschedule
  const toExecute: TrackRun[] = [];
  // Each entry carries the schedule the overflow must be re-slotted against. An email step
  // that hits its cap has to come back inside the EMAIL account's working window and
  // timezone — re-slotting it against the LinkedIn account's schedule (which is what this
  // did for every step type) parked email sends at a time the mailbox does not send, so the
  // run sat "running" while doing nothing.
  const toReschedule: Array<{ tr: TrackRun; schedule: ScheduleConfig; channel: string }> = [];

  const connectsPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));
  const messagesPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));
  const inmailsPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));
  const visitsPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));

  for (const tr of dueTrackRuns) {
    const steps = getSteps(tr.workflow_id, tr.track);
    const stepIndex = tr.current_step;
    if (stepIndex >= steps.length) { toExecute.push(tr); continue; }
    const step = steps[stepIndex];
    const limits = accountLimitsMap.get(tr.account_id)!;

    if (step.step_type === "connect") {
      // A connect step is "due" both when it's about to send a NEW request and when
      // it's just rechecking an already-sent one for acceptance (see the `degree === 1`
      // check in executeStep). Only the former spends a daily connect slot — the recheck
      // is a free DB read and must never be blocked by the cap, or an accepted connection
      // can never hand off to the next step (it'd be rescheduled behind new sends forever).
      if (tr.connection_requested_at) {
        toExecute.push(tr);
        continue;
      }
      const sentToday = connectsSentToday.get(tr.account_id) ?? 0;
      const planned = connectsPlanned.get(tr.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_connection_limit ?? 20)) {
        toReschedule.push({ tr, schedule: limits, channel: "LinkedIn connections" });
      } else {
        connectsPlanned.set(tr.account_id, planned + 1);
        toExecute.push(tr);
      }
    } else if (step.step_type === "message" || step.step_type === "voice") {
      const sentToday = messagesSentToday.get(tr.account_id) ?? 0;
      const planned = messagesPlanned.get(tr.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_message_limit ?? 50)) {
        toReschedule.push({ tr, schedule: limits, channel: "LinkedIn messages" });
      } else {
        messagesPlanned.set(tr.account_id, planned + 1);
        toExecute.push(tr);
      }
    } else if (step.step_type === "sales_inmail") {
      const sentToday = inmailsSentToday.get(tr.account_id) ?? 0;
      const planned = inmailsPlanned.get(tr.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_inmail_limit ?? 15)) {
        toReschedule.push({ tr, schedule: limits, channel: "InMail" });
      } else {
        inmailsPlanned.set(tr.account_id, planned + 1);
        toExecute.push(tr);
      }
    } else if (step.step_type === "email") {
      // Belongs to emailCampaignTick. Leaving it due here would send it from the browser loop.
      continue;
    } else if (step.step_type === "visit" || step.step_type === "like_posts") {
      const sentToday = visitsSentToday.get(tr.account_id) ?? 0;
      const planned = visitsPlanned.get(tr.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_visit_limit ?? 150)) {
        toReschedule.push({ tr, schedule: limits, channel: "LinkedIn visits" });
      } else {
        visitsPlanned.set(tr.account_id, planned + 1);
        toExecute.push(tr);
      }
    } else {
      // delay — no limit
      toExecute.push(tr);
    }
  }

  // Reschedule overflow to tomorrow, each against the schedule of the account that actually
  // hit its cap. Logged at `warn`: a campaign parked on a daily cap looks identical to a
  // stalled one from the outside, and `info` buried that in the ordinary step chatter.
  if (leaseLost()) { console.warn("[runner] LinkedIn lease lost — ending tick before rescheduling"); return; }
  for (const { tr, schedule, channel } of toReschedule) {
    const slot = rescheduleToTomorrow(schedule);
    db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(slot, tr.id);
    log(db, tr.run_id, tr.target_id, "warn", `Daily ${channel} limit reached — rescheduled to ${slot}`);
  }

  // Execute what's left, until the tick's soft budget runs out.
  //
  // A tick draining a backlog can legitimately run past any fixed wall-clock budget. Letting
  // the outer watchdog abort it instead is not safe: withTimeout stops the CALLER waiting, it
  // does not cancel the step, so the loop would begin a fresh tick while the abandoned
  // Playwright step is still driving the browser — two ticks on one LinkedIn session, which
  // is the single thing this loop is serialised to prevent. Ending cooperatively between
  // profiles keeps that invariant: whatever is left stays due and is picked up next tick.
  const tickDeadline = Date.now() + TICK_SOFT_BUDGET_MS;
  let executed = 0;
  for (const tr of toExecute) {
    if (Date.now() > tickDeadline) {
      console.log(`[runner] Tick soft budget reached — ${executed}/${toExecute.length} profiles done, remainder stays due`);
      break;
    }
    if (leaseLost()) {
      console.warn(`[runner] LinkedIn lease lost — stopping tick after ${executed}/${toExecute.length} profiles`);
      break;
    }
    if (tr.track === "email") continue;
    const steps = getSteps(tr.workflow_id, tr.track);
    const limits = accountLimitsMap.get(tr.account_id)!;
    const emailAccountId = tr.email_account_id ?? null;

    const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(tr.run_id) as { status: string } | undefined;
    if (!runStatus || runStatus.status !== "running") continue;

    const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(tr.target_id) as Target;
    // Atomic claim: never two workers (or a still-running orphaned step) on one track.
    if (!claimTrack(db, tr.id, WORKER_ID, tr.current_step)) continue;
    // Bounded so one wedged profile cannot stop every profile behind it in the queue. On a
    // timeout the abandoned step keeps its track claim until it really ends, and whatever it
    // was sending is marked uncertain, so the next tick moves the track on WITHOUT resending.
    await guard(
      `Step for target ${tr.target_id}`,
      EXECUTE_STEP_TIMEOUT_MS,
      async () => {
        try {
          await executeStep(db, tr.run_id, tr, target, steps, tr.account_id, limits, emailAccountId, null, getWorkflowPrompt(tr.workflow_id));
        } finally {
          releaseTrack(db, tr.id, WORKER_ID);
        }
      },
      (err) => {
        log(db, tr.run_id, tr.target_id, "error", `Step aborted: ${err.message}`);
        if (err instanceof WatchdogTimeoutError) markTrackActionsUncertain(db, tr.id, err.message);
      },
    );
    // Progress through a long tick is liveness too — without this the indicator flags a
    // runner that is working hard through a backlog.
    executed += 1;
    heartbeat(db, stillActive);
    await randomDelay(PROFILE_DELAY_MIN, PROFILE_DELAY_MAX);
  }
}
