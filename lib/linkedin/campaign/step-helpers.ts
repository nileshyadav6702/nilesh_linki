import { getDb } from "@/lib/db";
import { saveSessionState } from "@/lib/linkedin/session";
import {
  claimLinkedinAction, markLinkedinActionSent, markLinkedinActionAfterError, linkedinActionKey,
  type LinkedinActionType,
} from "@/lib/linkedin/actions";
import { AI_BLOCKED_RETRY_HOURS, CONNECTION_RECHECK_HOURS } from "./constants";
import { log, nowIso, trAdvance, trHold, trWait } from "./track-state";
import type { Template, TrackRun, WorkflowStep } from "./types";

// ─── claim-before-send ───────────────────────────────────────────────────────
// See lib/linkedin/actions.ts. A LinkedIn action is claimed before the browser is driven; a
// step that finds its action already sent, or uncertain, moves on without sending again.

export function actionInput(type: LinkedinActionType, runId: string, tr: TrackRun, step: WorkflowStep, accountId: string, targetId: string) {
  return { key: linkedinActionKey(type, runId, tr.id, step.id), type, accountId, runId, trackId: tr.id, stepId: step.id, targetId };
}

/**
 * If this step's action already went out (or may have), finish the step without resending
 * and return true. 'uncertain' is flagged on the track and logged for a human to check.
 */
export function settlePriorLinkedinAction(
  db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, steps: WorkflowStep[], targetId: string,
  name: string, type: LinkedinActionType, status: "sent" | "uncertain" | null,
): boolean {
  if (!status) return false;
  const what = type === "connect" ? "connection request" : type === "inmail" ? "InMail" : type;
  db.transaction(() => {
    if (type === "connect") {
      db.prepare("UPDATE targets SET connection_requested_at = COALESCE(connection_requested_at, ?) WHERE id = ?").run(nowIso(), targetId);
      trWait(db, tr, CONNECTION_RECHECK_HOURS, "Invitation sent — waiting for them to accept");
    } else {
      if (type === "message") db.prepare("UPDATE targets SET message_sent_at = COALESCE(message_sent_at, ?) WHERE id = ?").run(nowIso(), targetId);
      if (type === "inmail") db.prepare("UPDATE targets SET inmail_sent_at = COALESCE(inmail_sent_at, ?), message_sent_at = COALESCE(message_sent_at, ?) WHERE id = ?").run(nowIso(), nowIso(), targetId);
      trAdvance(db, tr, steps);
    }
    if (status === "uncertain") {
      const reason = `Delivery of the ${what} is uncertain (a previous attempt timed out or the worker stopped mid-send). Not resent - check LinkedIn manually.`;
      db.prepare("UPDATE run_profile_tracks SET error_message = ? WHERE id = ?").run(reason, tr.id);
      log(db, runId, targetId, "warn", `${reason} (${name})`);
    } else {
      log(db, runId, targetId, "info", `The ${what} to ${name} was already sent — not resending, moving on`);
    }
  })();
  return true;
}

/** Claim, then send. On a thrown send the claim is closed as failed (retryable) or uncertain. */
export async function sendLinkedinAction(
  db: ReturnType<typeof getDb>, input: ReturnType<typeof actionInput> & { body?: string | null }, send: () => Promise<void>,
): Promise<{ claimed: true; id: string } | { claimed: false; status: "sent" | "uncertain" }> {
  const claim = claimLinkedinAction(db, input);
  if (!claim.claimed) return { claimed: false, status: claim.status };
  try {
    await send();
  } catch (err) {
    markLinkedinActionAfterError(db, claim.id, err);
    throw err;
  }
  markLinkedinActionSent(db, claim.id);
  return claim;
}

/**
 * The step has nothing to send (an empty template, a missing InMail subject): the user must fix
 * the step. Hold the lead on it, never skip it as if it had been sent.
 */
export function holdForMissingContent(db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, targetId: string, name: string, what: string) {
  const why = `Nothing to send: ${what}. Fix the step to continue`;
  trHold(db, tr, AI_BLOCKED_RETRY_HOURS, why);
  log(db, runId, targetId, "warn", `${why} — holding ${name}, checking again in ${AI_BLOCKED_RETRY_HOURS}h`);
}

/** AI writing is blocked on something the user must fix: hold the step, never skip it. */
export function holdForAi(db: ReturnType<typeof getDb>, runId: string, tr: TrackRun, targetId: string, name: string, reason: string) {
  const why = `AI writing blocked: ${reason}`;
  trHold(db, tr, AI_BLOCKED_RETRY_HOURS, why);
  log(db, runId, targetId, "warn", `${why} — holding ${name}, retrying in ${AI_BLOCKED_RETRY_HOURS}h`);
}

/**
 * Template body for a message/InMail step: a random pick from the step's template pool, else
 * its single template. Only templates belonging to the run's workspace are eligible, so a
 * step can never render another tenant's template by id.
 */
export function stepTemplateBody(db: ReturnType<typeof getDb>, step: WorkflowStep, runId: string): string | null {
  const ws = (db.prepare("SELECT workspace_id FROM runs WHERE id = ?").get(runId) as { workspace_id: string | null } | undefined)?.workspace_id ?? null;
  const pool = db.prepare(`SELECT t.body FROM workflow_step_templates wst JOIN templates t ON t.id = wst.template_id
    WHERE wst.step_id = ? AND t.workspace_id IS ?`).all(step.id, ws) as Array<{ body: string }>;
  if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)].body;
  if (!step.template_id) return null;
  const tmpl = db.prepare("SELECT body FROM templates WHERE id = ? AND workspace_id IS ?").get(step.template_id, ws) as Pick<Template, "body"> | undefined;
  return tmpl?.body ?? null;
}

/** Session cookies are a convenience after a send; failing to save them must not fail a sent step. */
export async function saveSessionAfterSend(accountId: string): Promise<void> {
  try { await saveSessionState(accountId); } catch (err) {
    console.warn(`[runner] Could not save session state for ${accountId}:`, err instanceof Error ? err.message : err);
  }
}
