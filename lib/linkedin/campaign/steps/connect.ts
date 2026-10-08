import { getSessionPage } from "@/lib/linkedin/session";
import { sendConnectionRequest } from "@/lib/linkedin/connect";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { CONNECTION_MAX_WAIT_DAYS, CONNECTION_RECHECK_HOURS } from "../constants";
import { actionInput, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction } from "../step-helpers";
import { getLinkedinUrl } from "../resolve-url";
import { enforceSchedule, hoursSince, log, nowIso, trAdvance, trSkip, trWait } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

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
    const hoursSinceRequest = hoursSince(freshTarget.connection_requested_at);
    if (hoursSinceRequest / 24 > CONNECTION_MAX_WAIT_DAYS) {
      log(db, runId, target.id, "warn", `${name} did not accept after ${CONNECTION_MAX_WAIT_DAYS} days — skipping`);
      trSkip(db, tr, `Did not accept connection after ${CONNECTION_MAX_WAIT_DAYS} days`);
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
  const sent = await sendLinkedinAction(db, connect, async () => {
    const page = await getSessionPage(accountId);
    try { await sendConnectionRequest(page, linkedinUrl); } finally { await page.close(); }
  });
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "connect", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
    trWait(db, tr, CONNECTION_RECHECK_HOURS);
    log(db, runId, target.id, "info", `Connection request sent to ${name} — will recheck in ${CONNECTION_RECHECK_HOURS}h`);
  })();
}
