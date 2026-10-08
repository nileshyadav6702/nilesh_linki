import { sendEmailDurably } from "@/lib/email/infrastructure";
import { campaignEmailsToday } from "@/lib/linkedin/actions";
import { peekApprovedDraft, consumeDraft } from "@/lib/linkedin/step-drafts";
import { premium } from "@/lib/premium";
import { decryptSecret } from "@/lib/crypto";
import { addSuppression } from "@/lib/platform/suppression";
import { verifyEmailAddress, emailStatusFor, suppressionSourceFor, needsPreSendVerification } from "@/lib/email/verify";
import { renderOutreachTemplate } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { EMAIL_RECHECK_INTERVAL_MS } from "../constants";
import { effectiveEmailLimit, emailPaceGate, rescheduleToTomorrow } from "../schedule";
import { holdForAi } from "../step-helpers";
import { ensureApolloEnriched } from "../pre-enrich";
import { enforceSchedule, log, trAdvance, trFail, trRecordContext, trReschedule, trSkip } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

export async function runEmailStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, emailAccountId, emailAccountLimits, campaignPrompt } = ctx;
  await ensureApolloEnriched(db, target, runId);

  if (!emailAccountId || !emailAccountLimits) {
    log(db, runId, target.id, "warn", `Email step skipped — no email account configured on this run`);
    trAdvance(db, tr, steps);
    return;
  }

  if (!enforceSchedule(db, tr, runId, target.id, name, emailAccountLimits)) return;

  const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
  if (!freshTarget.email) {
    // No email even after Apollo enrichment — skip only this email track
    log(db, runId, target.id, "warn", `${name} has no email address — skipping email track`);
    trSkip(db, tr, "No email address found");
    return;
  }
  if (freshTarget.email_status === "invalid") {
    log(db, runId, target.id, "warn", `${name} has an invalid email address — unenrolling email track`);
    trSkip(db, tr, "Email bounced — invalid address");
    return;
  }
  if (freshTarget.email_status === "catchall") {
    log(db, runId, target.id, "warn", `${name}'s domain accepts all addresses — unenrolling email track`);
    trSkip(db, tr, "Catch-all domain — do not send");
    return;
  }
  // Just-in-time verification. This is the ONLY place an address earns "verified": it runs
  // a real SMTP RCPT probe, unlike the bulk queue, which can only rule addresses out.
  // Anything not already probed is probed here, immediately before the send that would
  // otherwise generate the bounce. A proven-dead mailbox or a catch-all domain goes on the
  // do-not-send list and the track is unenrolled; only an inconclusive result is sent to.
  //
  // An inconclusive verdict leaves the status at 'unverified', so without a throttle every
  // follow-up in a sequence would re-run the same 8s SMTP probe against the same mailbox.
  // `email_verified_at` records when the address was last CHECKED (whatever the outcome),
  // and a check inside the window is not repeated.
  // SQLite's datetime('now') is UTC in "YYYY-MM-DD HH:MM:SS" form, which Date.parse would
  // otherwise read as local time. Values already written as ISO are left alone.
  const lastChecked = freshTarget.email_verified_at
    ? Date.parse(/[TZ]/.test(freshTarget.email_verified_at) ? freshTarget.email_verified_at : `${freshTarget.email_verified_at.replace(" ", "T")}Z`)
    : NaN;
  const recentlyChecked = Number.isFinite(lastChecked) && Date.now() - lastChecked < EMAIL_RECHECK_INTERVAL_MS;
  // `checked` counts as not-yet-probed: the bulk queue can only confirm the domain, so an
  // address it passed still needs the RCPT probe here. Without this a bulk check would
  // silently switch off pre-send verification for every contact it touched.
  if (needsPreSendVerification(freshTarget.email_status) && !recentlyChecked) {
    const senderRow = db.prepare("SELECT from_email FROM email_accounts WHERE workspace_id = ? AND is_verified = 1 AND from_email IS NOT NULL ORDER BY created_at LIMIT 1").get(target.workspace_id) as { from_email: string } | undefined;
    const verdict = await verifyEmailAddress(freshTarget.email, { fromEmail: senderRow?.from_email });
    db.prepare("UPDATE targets SET email_status = ?, email_verified_at = datetime('now') WHERE id = ?").run(emailStatusFor(verdict.status), target.id);
    const source = suppressionSourceFor(verdict.status);
    if (source) {
      addSuppression({ workspaceId: target.workspace_id, kind: "email", value: freshTarget.email, reason: `Email verification: ${verdict.reason}`, source, targetId: target.id });
      log(db, runId, target.id, "warn", `${name}'s email failed verification (${verdict.reason}) — added to do-not-send, unenrolling email track`);
      trSkip(db, tr, source === "catchall" ? "Catch-all domain — do not send" : "Email failed verification — invalid address");
      return;
    }
  }
  if (freshTarget.company_id) {
    const company = db.prepare("SELECT email_domain_invalid FROM companies WHERE id = ?").get(freshTarget.company_id) as { email_domain_invalid: number } | undefined;
    if (company?.email_domain_invalid) {
      log(db, runId, target.id, "warn", `${name}'s company email domain is flagged invalid — unenrolling email track`);
      trSkip(db, tr, "Email domain invalid — company flagged");
      return;
    }
  }

  let emailSubject = "";
  let emailBody = "";
  let emailVariantId: string | null = null;
  // Consumed only once the email is handed to the provider (see the message step).
  const approvedEmail = peekApprovedDraft(db, target.id, "email", step.id, (step.email_position ?? 1) === 1);
  if (approvedEmail) {
    emailSubject = approvedEmail.subject ?? "";
    emailBody = approvedEmail.body;
    log(db, runId, target.id, "info", `Using the approved agent email for ${name}`);
  } else if (step.ai_enabled) {
    if (!premium?.ai) {
      holdForAi(db, runId, tr, target.id, name, "the AI writer is unavailable in this build");
      return;
    }
    const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'openrouter' AND workspace_id = ?").get(target.workspace_id) as { api_key: string } | undefined;
    const agentCfgForEmail = premium.ai.getAgentConfig(target.workspace_id);
    const resolvedEmailModel = step.ai_model || agentCfgForEmail.default_model;
    if (!integration?.api_key || !resolvedEmailModel) {
      holdForAi(db, runId, tr, target.id, name, "the OpenRouter key or model is missing");
      return;
    }
    const contactData = premium.ai.getContactWithCompany(target.id);
    if (!contactData) {
      log(db, runId, target.id, "error", `Could not load contact data for AI email — failing step for ${name}`);
      trFail(db, tr, "Contact data unavailable for AI email");
      return;
    }
    log(db, runId, target.id, "info", `Generating AI email for ${name} with ${resolvedEmailModel}`);
    const emailPosition = step.email_position ?? 1;
    let followupContext: { followupNumber: number; previousSubject: string; previousBody: string } | undefined;
    if (emailPosition > 1 && (tr.last_email_subject || tr.last_email_body)) {
      followupContext = {
        followupNumber: emailPosition - 1,
        previousSubject: tr.last_email_subject ?? "",
        previousBody: tr.last_email_body ?? "",
      };
    }
    const result = await premium.ai.writeEmail({
      apiKey: decryptSecret(integration.api_key)!,
      model: resolvedEmailModel,
      stepType: "email",
      stepPrompt: step.ai_prompt ?? "",
      maxWords: step.ai_max_words ?? undefined,
      language: step.ai_language ?? undefined,
      campaignPrompt: campaignPrompt ?? undefined,
      contact: contactData.contact,
      company: contactData.company,
      agentConfig: agentCfgForEmail,
      followupContext,
      replyContext: tr.pending_reply_context ?? undefined,
      runId,
      targetId: target.id,
      stepId: step.id,
    });
    emailSubject = result.subject;
    emailBody = result.body;
    // The OOO reply context is one-shot; it is cleared once this email is sent (below).
  } else {
    const customVals = loadTargetCustomValues(db, target.workspace_id, target.id);
    const emailVariants = db.prepare("SELECT id, subject, body FROM workflow_step_email_variants WHERE step_id = ? ORDER BY position").all(step.id) as Array<{ id: string; subject: string; body: string }>;
    const candidates: Array<{ id: string | null; subject: string; body: string }> = [
      { id: null, subject: step.email_subject ?? "", body: step.email_body ?? "" },
      ...emailVariants,
    ];
    const chosen = candidates.length > 1 ? candidates[Math.floor(Math.random() * candidates.length)] : candidates[0];
    emailVariantId = chosen.id;
    emailSubject = renderOutreachTemplate(chosen.subject, freshTarget, customVals);
    emailBody = renderOutreachTemplate(chosen.body, freshTarget, customVals);
  }

  if (!emailBody) {
    log(db, runId, target.id, "warn", `No email body for email step — skipping ${name}`);
    trAdvance(db, tr, steps);
    return;
  }

  const emailAccount = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(emailAccountId) as {
    id: string; from_email: string; from_name: string | null; reply_to: string | null;
    smtp_host: string; smtp_port: number; smtp_secure: number;
    username: string; password: string; signature: string | null;
  } | undefined;

  if (!emailAccount) {
    log(db, runId, target.id, "error", `Email account ${emailAccountId} not found`);
    trFail(db, tr, "Email account missing");
    return;
  }

  // Last-line-of-defense: re-check the daily limit for this email account against ground-truth
  // (sent_messages + open email_jobs for this mailbox, not log text). If any prior gate is
  // buggy, this catches the overshoot and reschedules instead of sending.
  const sentTodayActual = campaignEmailsToday(db, emailAccountId, emailAccountLimits.timezone);
  const hardLimit = effectiveEmailLimit(emailAccountLimits);
  if (sentTodayActual >= hardLimit) {
    log(db, runId, target.id, "warn", `Daily limit guard tripped for ${emailAccountId} (${sentTodayActual}/${hardLimit}) — rescheduling ${name} to tomorrow`);
    trReschedule(db, tr, rescheduleToTomorrow(emailAccountLimits));
    return;
  }

  // Rate, not just volume: keep this account's sends spaced across the working window
  // rather than racing to exhaust the daily cap in one burst.
  const paceUntil = emailPaceGate(db, emailAccountId, emailAccountLimits, sentTodayActual, hardLimit);
  if (paceUntil) {
    log(db, runId, target.id, "info", `Pacing ${name} — next send window for ${emailAccountId} at ${paceUntil}`);
    trReschedule(db, tr, paceUntil);
    return;
  }

  // Step-level signature takes precedence; null means fall back to email account default
  const sig = (step.email_signature !== null ? step.email_signature : emailAccount.signature)?.trim();
  const finalEmailBody = sig ? `${emailBody}\n\n--\n${sig}` : emailBody;
  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending email to ${name} <${freshTarget.email}>`);
  await sendEmailDurably({
    workspaceId: target.workspace_id,
    emailAccountId,
    idempotencyKey: `campaign:${runId}:${tr.id}:${step.id}`,
    source: "campaign",
    targetId: target.id,
    runId,
    stepId: step.id,
    variantId: emailVariantId ?? undefined,
    to: freshTarget.email,
    subject: emailSubject,
    body: finalEmailBody,
    deliveryMode: step.email_delivery_mode === "enhanced" ? "enhanced" : "plain",
    trackOpens: step.email_delivery_mode === "enhanced" && step.email_track_opens === 1,
    trackClicks: step.email_delivery_mode === "enhanced" && step.email_track_clicks === 1,
  });
  db.transaction(() => {
    consumeDraft(db, approvedEmail);
    if (tr.pending_reply_context) db.prepare("UPDATE run_profile_tracks SET pending_reply_context = NULL WHERE id = ?").run(tr.id);
    trRecordContext(db, tr, { emailSubject, emailBody });
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `Email sent to ${name}`);
  })();
}
