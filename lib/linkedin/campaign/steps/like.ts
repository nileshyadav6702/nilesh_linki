import { getSessionPage } from "@/lib/linkedin/session";
import { likeRecentPosts } from "@/lib/linkedin/like";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { actionInput, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction } from "../step-helpers";
import { getLinkedinUrl } from "../resolve-url";
import { enforceSchedule, log, trAdvance } from "../track-state";
import type { StepContext } from "./context";

/** Like Posts: like the contact's 1–3 most recent posts so the next touch feels familiar. No posts is not a failure. */
export async function runLikePostsStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId, accountLimits } = ctx;
  if (!enforceSchedule(db, tr, runId, target.id, name, accountLimits)) return;
  const like = actionInput("like", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "like", settledPriorAction(db, like.key))) return;

  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  const count = Math.min(3, Math.max(1, step.like_count ?? 1));
  log(db, runId, target.id, "info", `Liking up to ${count} recent post(s) of ${name}`);
  const linkedinUrl = await getLinkedinUrl(db, target, accountId);
  let liked = 0;
  const sent = await sendLinkedinAction(db, like, async () => {
    const page = await getSessionPage(accountId);
    try { liked = await likeRecentPosts(page, linkedinUrl, count); } finally { await page.close(); }
  });
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "like", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", liked ? `Liked ${liked} post(s) of ${name}` : `${name} has no recent posts to like — moving on`);
  })();
}
