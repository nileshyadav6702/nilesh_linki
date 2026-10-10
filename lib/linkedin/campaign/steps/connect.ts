import { getSessionPage } from "@/lib/linkedin/session";
import { sendConnectionRequest } from "@/lib/linkedin/connect";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { CONNECTION_RECHECK_HOURS } from "../constants";
import { renderOutreachTemplate } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { invitationExpired, skipToEmail } from "../invitation-fallback";
import { actionInput, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction } from "../step-helpers";
import { getLinkedinUrl } from "../resolve-url";
import { enforceSchedule, log, nowIso, trAdvance, trWait } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

const NOTE_LIMIT = 300;

/** A note that fits LinkedIn's limit, ending at the last whole word (unless that loses too much). */
export function fitInvitationNote(note: string, limit = NOTE_LIMIT): string {
  if (note.length <= limit) return note;
  const cut = note.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit - 60 ? cut.slice(0, space) : cut).trimEnd();
}

export async function runConnectStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId, accountLimits } = ctx;
  if (!enforceSchedule(db, tr, runId, target.id, name, accountLimits)) return;

  const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
  if (freshTarget.degree === 1) {
    if (!freshTarget.connected_at) db.prepare("UPDATE targets SET connected_at = ? WHERE id = ?").run(nowIso(), target.id);
    log(db, runId, target.id, "info", `${name} already connected — skipping connect step`);
    trAdvance(db, tr, steps);
    return;
  }

  if (freshTarget.connection_requested_at) {
    if (invitationExpired(steps, freshTarget.connection_requested_at)) {
      skipToEmail(db, runId, tr, target.id, name, steps);
      return;
    }
    // Acceptance is detected by the daily sync-accepted job (scrolls invitation manager).
    // Runner just re-checks degree from DB — no per-profile page visits needed.
    log(db, runId, target.id, "info", `${name} not yet accepted — rechecking in ${CONNECTION_RECHECK_HOURS}h`);
    trWait(db, tr, CONNECTION_RECHECK_HOURS);
    return;
  }

  const connect = actionInput("connect", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "connect", settledPriorAction(db, connect.key))) return;

  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending connection request to ${name}`);
  const linkedinUrl = await getLinkedinUrl(db, target, accountId);
  let note = step.connect_note?.trim() ? renderOutreachTemplate(step.connect_note, freshTarget, loadTargetCustomValues(db, target.workspace_id, target.id)).trim() : null;
  // LinkedIn takes 300 characters. A long note (merged fields can push it over) ends at the last
  // whole word that fits, and the log says so, instead of being cut mid-word without a trace.
  if (note && note.length > NOTE_LIMIT) {
    const fitted = fitInvitationNote(note);
    log(db, runId, target.id, "warn", `Invitation note for ${name} is ${note.length} characters (LinkedIn allows ${NOTE_LIMIT}) — shortened to ${fitted.length}`);
    note = fitted;
  }
  let noteSent = false;
  let publicUrl: string | null = null;
  const sent = await sendLinkedinAction(db, connect, async () => {
    const page = await getSessionPage(accountId);
    try { ({ noteSent, publicUrl } = await sendConnectionRequest(page, linkedinUrl, note)); } finally { await page.close(); }
  });
  // Keep the public profile URL: acceptance sync and the sent-invitations check match on it, and
  // LinkedIn's internal "/in/ACoAA…" ids never show up there.
  if (publicUrl && /\/in\/ACo/i.test(freshTarget.linkedin_url ?? "")) {
    db.prepare("UPDATE targets SET linkedin_url = ? WHERE id = ?").run(publicUrl, target.id);
  }
  if (note && sent.claimed && !noteSent) log(db, runId, target.id, "warn", `LinkedIn did not allow a note for ${name} (free accounts get a few per month) — sent without it`);
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "connect", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
    trWait(db, tr, CONNECTION_RECHECK_HOURS);
    log(db, runId, target.id, "info", `Connection request sent to ${name} — will recheck in ${CONNECTION_RECHECK_HOURS}h`);
  })();
}
