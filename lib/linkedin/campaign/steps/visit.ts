import { getSessionPage } from "@/lib/linkedin/session";
import { visitProfile } from "@/lib/linkedin/visit";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { actionInput, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction } from "../step-helpers";
import { getLinkedinUrl } from "../resolve-url";
import { log, trAdvance } from "../track-state";
import type { StepContext } from "./context";

export async function runVisitStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId } = ctx;
  const visit = actionInput("visit", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "visit", settledPriorAction(db, visit.key))) return;
  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Visiting ${name}`);
  const linkedinUrl = await getLinkedinUrl(db, target, accountId);
  const sent = await sendLinkedinAction(db, visit, async () => {
    const page = await getSessionPage(accountId);
    try { await visitProfile(page, linkedinUrl); } finally { await page.close(); }
  });
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "visit", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `Visited ${name}`);
  })();
}
