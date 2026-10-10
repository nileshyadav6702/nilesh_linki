import { getSessionPage } from "@/lib/linkedin/session";
import { aiApiKey, modelFor } from "@/lib/ai/models";
import { sendMessage } from "@/lib/linkedin/message";
import { splitMessage } from "@/lib/linkedin/split-message";
import { failedAttemptBody, settledPriorAction } from "@/lib/linkedin/actions";
import { peekApprovedDraft, consumeDraft } from "@/lib/linkedin/step-drafts";
import { premium } from "@/lib/premium";
import { emitDomainEvent } from "@/lib/platform/events";
import { renderOutreachTemplate } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { CONNECTION_RECHECK_HOURS } from "../constants";
import { invitationExpired, skipNotConnected, skipToEmail } from "../invitation-fallback";
import { actionInput, holdForAi, holdForMissingContent, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction, stepTemplateBody } from "../step-helpers";
import { ensureSalesNavEnriched } from "../pre-enrich";
import { enforceSchedule, log, nowIso, trAdvance, trFail, trRecordContext, trWait } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

export async function runMessageStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId, accountLimits, campaignPrompt } = ctx;
  await ensureSalesNavEnriched(db, target, accountId);
  if (!enforceSchedule(db, tr, runId, target.id, name, accountLimits)) return;

  const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
  if (freshTarget.degree !== 1) {
    const requested = freshTarget.connection_requested_at;
    if (invitationExpired(steps, requested)) {
      skipToEmail(db, runId, tr, target.id, name, steps);
      return;
    }
    if (!requested) {
      skipNotConnected(db, runId, tr, target.id, name);
      return;
    }
    log(db, runId, target.id, "info", `${name} not yet connected — rescheduling message in ${CONNECTION_RECHECK_HOURS}h`);
    trWait(db, tr, CONNECTION_RECHECK_HOURS, "Invitation sent — waiting for them to accept");
    return;
  }

  const messageAction = actionInput("message", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "message", settledPriorAction(db, messageAction.key))) return;

  let messageText = "";
  // An AI agent's approved draft for this step replaces the step's own content. Read now,
  // consumed only after the send succeeds, so a failed send keeps the approved copy.
  const approvedDraft = peekApprovedDraft(db, target.id, "linkedin_message", step.id, (step.message_position ?? 1) === 1);
  const retryText = approvedDraft ? null : failedAttemptBody(db, messageAction.key);
  if (approvedDraft) {
    messageText = approvedDraft.body;
    log(db, runId, target.id, "info", `Using the approved agent draft for ${name}`);
  } else if (retryText) {
    // A retry after a failed send: the same words, not a new (and newly paid-for) AI message.
    messageText = retryText;
    log(db, runId, target.id, "info", `Retrying the same message for ${name}`);
  } else if (step.ai_enabled) {
    // Missing AI setup is the user's to fix: hold the step, never skip it as if it were done.
    if (!premium?.ai) {
      holdForAi(db, runId, tr, target.id, name, "the AI writer is unavailable in this build");
      return;
    }
    const integration = { api_key: aiApiKey(target.workspace_id) };
    const agentCfgForMsg = premium.ai.getAgentConfig(target.workspace_id);
    const resolvedMsgModel = modelFor("message");
    if (!integration?.api_key || !resolvedMsgModel) {
      holdForAi(db, runId, tr, target.id, name, "the OpenRouter key or model is missing");
      return;
    }
    const contactData = premium.ai.getContactWithCompany(target.id);
    if (!contactData) {
      log(db, runId, target.id, "error", `Could not load contact data for AI message — failing step for ${name}`);
      trFail(db, tr, "Contact data unavailable for AI message");
      return;
    }
    log(db, runId, target.id, "info", `Generating AI message for ${name} with ${resolvedMsgModel}`);
    const msgPosition = step.message_position ?? 1;
    let previousMessageContext: { followupNumber: number; previousMessage: string } | undefined;
    if (msgPosition > 1 && tr.last_linkedin_message) {
      previousMessageContext = { followupNumber: msgPosition - 1, previousMessage: tr.last_linkedin_message };
    }
    const result = await premium.ai.writeLinkedInMessage({
      apiKey: integration.api_key!,
      model: resolvedMsgModel,
      stepType: "message",
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
    messageText = result.body;
  } else {
    const customVals = loadTargetCustomValues(db, target.workspace_id, target.id);
    const tmplBody = stepTemplateBody(db, step, runId);
    if (tmplBody) messageText = renderOutreachTemplate(tmplBody, freshTarget, customVals);
    if (!messageText && step.message_body) messageText = renderOutreachTemplate(step.message_body, freshTarget, customVals);
  }
  if (!messageText) {
    holdForMissingContent(db, runId, tr, target.id, name, "the message step has no text");
    return;
  }

  if (!target.full_name) throw new Error(`Target ${target.id} has no full_name — cannot search messaging`);
  const fullName = target.full_name;
  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending message to ${name}`);
  const sent = await sendLinkedinAction(db, { ...messageAction, body: messageText }, async () => {
    const page = await getSessionPage(accountId);
    // Campaign settings → "Split messages into a conversation".
    const split = !!(db.prepare("SELECT a.split_messages FROM targets t JOIN agents a ON a.id = t.agent_id WHERE t.id = ?").get(target.id) as { split_messages: number } | undefined)?.split_messages;
    try { await sendMessage(page, { fullName, profileUrl: freshTarget.linkedin_url }, messageText, { parts: split ? splitMessage(messageText) : undefined }); } finally { await page.close(); }
  });
  if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "message", sent.status); return; }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    db.prepare("UPDATE targets SET message_sent_at = ? WHERE id = ?").run(nowIso(), target.id);
    consumeDraft(db, approvedDraft);
    trRecordContext(db, tr, { linkedinMessage: messageText });
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `Message sent to ${name}`);
  })();
  emitDomainEvent({ workspaceId: target.workspace_id, type: "linkedin.message_sent", entityType: "contact", entityId: target.id, payload: { run_id: runId } });
}
