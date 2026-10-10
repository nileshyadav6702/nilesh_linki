import { getDb } from "@/lib/db";
import { localWeekStartUtc } from "@/lib/outreach/schedule";
import { markNeedsReauth } from "@/lib/linkedin/session";
import { AccountRestrictedError, SessionExpiredError } from "@/lib/linkedin/session-guard";
import { WeeklyLimitError, AlreadyConnectedError, PendingInviteError, InviteNeedsEmailError, InviteNotConfirmedError } from "@/lib/linkedin/connect";
import { SenderPausedError, RecipientSuppressedError } from "@/lib/email/infrastructure";
import { isAiBlockingError } from "@/lib/ai/client";
import { findTargetSuppression } from "@/lib/platform/suppression";
import { CONNECTION_RECHECK_HOURS } from "../constants";
import { holdForAi } from "../step-helpers";
import { log, nowIso, trAdvance, trFail, trSkip, trWait } from "../track-state";
import type { AccountLimits, EmailAccountLimits, Target, TrackRun, WorkflowStep } from "../types";
import type { StepContext } from "./context";

/** Unexpected step errors are retried this many times (1h, 2h, 4h) before the track fails. */
const MAX_STEP_RETRIES = 3;

/** Unconfirmed invitations are retried this many times, this many hours apart. */
const MAX_INVITE_TRIES = 3;
const INVITE_RETRY_HOURS = 2;
import { runVisitStep } from "./visit";
import { runConnectStep } from "./connect";
import { runMessageStep } from "./message";
import { runInmailStep } from "./inmail";
import { runEmailStep } from "./email";
import { runLikePostsStep } from "./like";
import { runVoiceStep } from "./voice";

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

  // Auto-unenroll if the lead replied on either channel SINCE this enrollment — mark ALL its
  // track-runs skipped. A reply from before (an earlier campaign) doesn't end this sequence.
  const replyCheck = db.prepare(`SELECT t.last_replied_at, t.email_replied_at, rp.created_at enrolled_at FROM targets t
    JOIN run_profiles rp ON rp.id = ? WHERE t.id = ?`).get(tr.run_profile_id, target.id) as { last_replied_at: string | null; email_replied_at: string | null; enrolled_at: string | null } | undefined;
  const ms = (s: string | null | undefined) => (s ? Date.parse(/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`) : NaN);
  const since = ms(replyCheck?.enrolled_at);
  const repliedSince = (at: string | null | undefined) => !!at && (Number.isNaN(since) || ms(at) >= since);
  if (replyCheck && (repliedSince(replyCheck.last_replied_at) || repliedSince(replyCheck.email_replied_at))) {
    const channel = repliedSince(replyCheck.email_replied_at) ? "email" : "LinkedIn";
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
      case "like_posts": return await runLikePostsStep(ctx);
      case "voice": return await runVoiceStep(ctx);
    }
  } catch (err) {
    handleStepError(db, runId, tr, target, steps, name, err);
  }
}

/** Map a thrown step error to the track transition it calls for. */
export function handleStepError(
  db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, target: Target, steps: WorkflowStep[], name: string, err: unknown,
): void {
  const msg = err instanceof Error ? err.message : String(err);
  // AI writing is blocked on the user (key rejected, out of credit, spend cap): hold the
  // step and retry later. Skipping it would "complete" the track with nothing sent.
  if (isAiBlockingError(err)) {
    holdForAi(db, runId, tr, target.id, name, msg);
    return;
  }
  // LinkedIn's weekly invitation limit belongs to the ACCOUNT: block its invitations until the
  // week resets (other steps, like messages to connections, keep going), and retry this one then.
  if (err instanceof WeeklyLimitError) {
    const until = blockConnectsForWeek(db, tr.account_id);
    log(db, runId, target.id, "error", `LinkedIn's weekly invitation limit was reached on this account — invitations resume ${until.slice(0, 10)}`);
    db.prepare("UPDATE run_profile_tracks SET next_step_at = ? WHERE id = ?").run(until, tr.id);
    return;
  }
  // The session was signed out (or hit a security check): reconnecting the account fixes it, so
  // hold the lead instead of failing it, and flag the account.
  if (err instanceof SessionExpiredError || err instanceof AccountRestrictedError) {
    log(db, runId, target.id, "error", `${msg} — reconnect the LinkedIn account; holding ${name}`);
    void markNeedsReauth(tr.account_id).catch(() => {});
    trWait(db, tr, 2, "The LinkedIn account needs reconnecting");
    return;
  }
  if (err instanceof AlreadyConnectedError) {
    log(db, runId, target.id, "info", `${name} already connected — advancing`);
    db.prepare("UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?").run(nowIso(), target.id);
    trAdvance(db, tr, steps);
    return;
  }
  // The invitation couldn't be confirmed (dialog slow, LinkedIn hiccup): nothing was recorded as
  // sent, so retry in a couple of hours — a retry that finds it pending counts it as sent. Give up
  // after a few tries rather than looping.
  if (err instanceof InviteNotConfirmedError) {
    const tries = (db.prepare("SELECT MAX(attempt) n FROM linkedin_actions WHERE track_id = ? AND type = 'connect'").get(tr.id) as { n: number | null }).n ?? 1;
    if (tries >= MAX_INVITE_TRIES) {
      log(db, runId, target.id, "error", `Could not send the invitation to ${name} after ${tries} tries: ${msg}`);
      trFail(db, tr, msg);
    } else {
      log(db, runId, target.id, "warn", `Invitation to ${name} not confirmed (${msg}) — retrying in ${INVITE_RETRY_HOURS}h`);
      trWait(db, tr, INVITE_RETRY_HOURS, "Invitation not confirmed — trying again");
    }
    return;
  }
  // LinkedIn wants their email to invite them: LinkedIn steps can't run, email ones still can.
  if (err instanceof InviteNeedsEmailError) {
    log(db, runId, target.id, "warn", `${name}: LinkedIn requires their email to connect — skipping LinkedIn steps`);
    trSkip(db, tr, msg);
    db.prepare(`UPDATE run_profile_tracks SET next_step_at = datetime('now')
      WHERE run_profile_id = ? AND track = 'email' AND state = 'in_progress' AND (next_step_at IS NULL OR next_step_at > datetime('now'))`).run(tr.run_profile_id);
    return;
  }
  if (err instanceof PendingInviteError) {
    log(db, runId, target.id, "info", `${name} invite already pending — will recheck`);
    if (!target.connection_requested_at) db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
    trWait(db, tr, CONNECTION_RECHECK_HOURS, "Invitation sent — waiting for them to accept");
    return;
  }
  // The mailbox is paused — manually, or by the bounce/complaint policy. That says nothing
  // about this contact, so the track is HELD rather than failed. Failing it burned contacts
  // (they never get a later attempt) for a condition that clears as soon as the mailbox is
  // resumed, and it read as a per-contact send error in the run log, which is misleading.
  if (err instanceof SenderPausedError) {
    log(db, runId, target.id, "warn", `Sending mailbox is paused (${msg}) — holding ${name} until it resumes`);
    trWait(db, tr, 1, "The sending mailbox is paused");
    return;
  }
  // On the do-not-send list. Permanent for this channel, but it is a deliberate exclusion,
  // not a failure — 'skipped' is what the UI and analytics read as "we chose not to send".
  if (err instanceof RecipientSuppressedError) {
    log(db, runId, target.id, "warn", `${name} is suppressed (${msg}) — unenrolling email track`);
    trSkip(db, tr, msg);
    return;
  }
  // Anything else may be a one-off (a slow page, a LinkedIn hiccup): retry with backoff first.
  // (LinkedIn steps only: an email job has its own retry budget, spent by the time it throws here.)
  const retries = (db.prepare("SELECT COALESCE(retry_count, 0) n FROM run_profile_tracks WHERE id = ?").get(tr.id) as { n: number } | undefined)?.n ?? 0;
  if (tr.track === "linkedin" && retries < MAX_STEP_RETRIES) {
    const hours = 2 ** retries;
    db.prepare("UPDATE run_profile_tracks SET retry_count = ?, error_message = ? WHERE id = ?").run(retries + 1, msg.slice(0, 500), tr.id);
    log(db, runId, target.id, "warn", `Error on ${name}: ${msg} — retrying in ${hours}h (${retries + 1}/${MAX_STEP_RETRIES})`);
    trWait(db, tr, hours, `Retrying after an error (${retries + 1}/${MAX_STEP_RETRIES})`);
    return;
  }
  log(db, runId, target.id, "error", `Error on ${name}: ${msg} — giving up after ${MAX_STEP_RETRIES} retries`);
  trFail(db, tr, msg);
}

/** Block invitations from this account until its next local week (ISO time returned). */
export function blockConnectsForWeek(db: ReturnType<typeof getDb>, accountId: string | null): string {
  const tz = accountId ? (db.prepare("SELECT timezone FROM accounts WHERE id = ?").get(accountId) as { timezone: string | null } | undefined)?.timezone ?? "UTC" : "UTC";
  const until = new Date(Date.parse(localWeekStartUtc(tz)) + 7 * 86_400_000).toISOString();
  if (accountId) db.prepare("UPDATE accounts SET connects_blocked_until = ?, connects_blocked_at = datetime('now') WHERE id = ?").run(until, accountId);
  return until;
}
