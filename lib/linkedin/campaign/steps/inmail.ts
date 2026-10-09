import { getSessionPage } from "@/lib/linkedin/session";
import { aiApiKey, modelFor } from "@/lib/ai/models";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { premium } from "@/lib/premium";
import { renderOutreachTemplate } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { actionInput, holdForAi, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction, stepTemplateBody } from "../step-helpers";
import { ensureSalesNavEnriched } from "../pre-enrich";
import { enforceSchedule, log, nowIso, trAdvance, trFail, trRecordContext, trSkip } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

// Sales Navigator InMail — reaches NON-connections (no degree gate), needs a
// subject + body, costs one InMail credit. Body config mirrors the message
// step (AI writer OR templates OR raw body); subject comes from email_subject.

export async function runInmailStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId, accountLimits, campaignPrompt } = ctx;
  if (!premium?.inmail) {
    log(db, runId, target.id, "warn", `Sales Nav InMail is not implemented in this build. Skipping ${name}`);
    trAdvance(db, tr, steps);
    return;
  }
  await ensureSalesNavEnriched(db, target, accountId);
  if (!enforceSchedule(db, tr, runId, target.id, name, accountLimits)) return;

  const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
  if (!freshTarget.sales_nav_url) {
    log(db, runId, target.id, "warn", `${name} has no Sales Nav URL — cannot send InMail, skipping`);
    trSkip(db, tr, "No Sales Nav URL for InMail");
    return;
  }
  const inmailAction = actionInput("inmail", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "inmail", settledPriorAction(db, inmailAction.key))) return;

  let inmailBody = "";
  let inmailSubject = "";
  if (step.ai_enabled) {
    if (!premium?.ai) {
      holdForAi(db, runId, tr, target.id, name, "the AI writer is unavailable in this build");
      return;
    }
    const integration = { api_key: aiApiKey(target.workspace_id) };
    const agentCfgForMsg = premium.ai.getAgentConfig(target.workspace_id);
    const resolvedMsgModel = modelFor("inmail");
    if (!integration?.api_key || !resolvedMsgModel) {
      holdForAi(db, runId, tr, target.id, name, "the OpenRouter key or model is missing");
      return;
    }
    const contactData = premium.ai.getContactWithCompany(target.id);
    if (!contactData) {
      log(db, runId, target.id, "error", `Could not load contact data for AI InMail — failing step for ${name}`);
      trFail(db, tr, "Contact data unavailable for AI InMail");
      return;
    }
    log(db, runId, target.id, "info", `Generating AI InMail for ${name} with ${resolvedMsgModel}`);
    const msgPosition = step.message_position ?? 1;
    let previousMessageContext: { followupNumber: number; previousMessage: string } | undefined;
    if (msgPosition > 1 && tr.last_linkedin_message) {
      previousMessageContext = { followupNumber: msgPosition - 1, previousMessage: tr.last_linkedin_message };
    }
    const result = await premium.ai.writeSalesInMail({
      apiKey: integration.api_key!,
      model: resolvedMsgModel,
      stepType: "sales_inmail",
      stepPrompt: step.ai_prompt ?? "",
      maxWords: step.ai_max_words ?? undefined,
      language: step.ai_language ?? undefined,
      campaignPrompt: campaignPrompt ?? undefined,
      contact: contactData.contact,
      company: contactData.company,
      agentConfig: agentCfgForMsg,
      previousMessageContext,
      runId,
      targetId: target.id,
      stepId: step.id,
    });
    inmailBody = result.body;
    inmailSubject = result.subject;
  } else {
    const customVals = loadTargetCustomValues(db, target.workspace_id, target.id);
    const tmplBody = stepTemplateBody(db, step, runId);
    if (tmplBody) inmailBody = renderOutreachTemplate(tmplBody, freshTarget, customVals);
    if (!inmailBody && step.message_body) inmailBody = renderOutreachTemplate(step.message_body, freshTarget, customVals);
    inmailSubject = renderOutreachTemplate(step.email_subject ?? "", freshTarget, customVals).trim();
  }
  if (!inmailBody) {
    log(db, runId, target.id, "warn", `No body for InMail step — skipping ${name}`);
    trAdvance(db, tr, steps);
    return;
  }
  if (!inmailSubject) {
    log(db, runId, target.id, "warn", `No subject for InMail step (required) — skipping ${name}`);
    trAdvance(db, tr, steps);
    return;
  }

  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending InMail to ${name}`);
  const inmail = premium.inmail;
  const salesNavUrl = freshTarget.sales_nav_url;
  const sent = await sendLinkedinAction(db, inmailAction, async () => {
    const page = await getSessionPage(accountId);
    try { await inmail.sendInMail(page, salesNavUrl, inmailSubject, inmailBody); } finally { await page.close(); }
  });
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "inmail", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    db.prepare("UPDATE targets SET inmail_sent_at = ?, message_sent_at = COALESCE(message_sent_at, ?) WHERE id = ?").run(nowIso(), nowIso(), target.id);
    trRecordContext(db, tr, { linkedinMessage: inmailBody });
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `InMail sent to ${name}`);
  })();
}
