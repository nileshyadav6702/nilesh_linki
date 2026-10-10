import { sendEmailDurably, EmailRetryScheduledError } from "@/lib/email/infrastructure";
import { aiApiKey, modelFor } from "@/lib/ai/models";
import { applyUnsubscribeVariable, unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { signatureText } from "@/lib/email/signature";
import { campaignEmailsToday } from "@/lib/linkedin/actions";
import { peekApprovedDraft, consumeDraft } from "@/lib/linkedin/step-drafts";
import { premium } from "@/lib/premium";
import { addSuppression } from "@/lib/platform/suppression";
import { verifyEmailAddress, emailStatusFor, suppressionSourceFor, needsPreSendVerification } from "@/lib/email/verify";
import { renderOutreachTemplate, findUnresolvedTokens } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { EMAIL_RECHECK_INTERVAL_MS } from "../constants";
import { effectiveEmailLimit, emailPaceGate, rescheduleToTomorrow } from "../schedule";
import { holdForAi, holdForMissingContent } from "../step-helpers";
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
  // One job per (run, track, step). If an earlier attempt already queued it (a transient
  // provider error left it pending for retry), re-send THAT job — same content, headers and
  // Message-ID — rather than writing (and paying for) a different email.
  const idempotencyKey = `campaign:${runId}:${tr.id}:${step.id}`;
  const queuedJob = db.prepare("SELECT subject, body_text FROM email_jobs WHERE workspace_id = ? AND idempotency_key = ?")
    .get(target.workspace_id, idempotencyKey) as { subject: string; body_text: string } | undefined;
  // Consumed only once the email is handed to the provider (see the message step).
  const approvedEmail = peekApprovedDraft(db, target.id, "email", step.id, (step.email_position ?? 1) === 1);
  if (queuedJob) {
    emailSubject = queuedJob.subject;
    emailBody = queuedJob.body_text;
  } else if (approvedEmail) {
    emailSubject = approvedEmail.subject ?? "";
    emailBody = approvedEmail.body;
    log(db, runId, target.id, "info", `Using the approved agent email for ${name}`);
  } else if (step.ai_enabled) {
    if (!premium?.ai) {
      holdForAi(db, runId, tr, target.id, name, "the AI writer is unavailable in this build");
      return;
    }
    const integration = { api_key: aiApiKey(target.workspace_id) };
    const agentCfgForEmail = premium.ai.getAgentConfig(target.workspace_id);
    const resolvedEmailModel = modelFor("email");
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
      apiKey: integration.api_key!,
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
    holdForMissingContent(db, runId, tr, target.id, name, "the email step has no body");
    return;
  }

  const emailAccount = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(emailAccountId) as {
    id: string; from_email: string; from_name: string | null; reply_to: string | null;
    smtp_host: string; smtp_port: number; smtp_secure: number;
    username: string; password: string; signature: string | null;
    track_opens: number | null; include_unsubscribe: number | null; postal_address?: string | null;
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
    trReschedule(db, tr, rescheduleToTomorrow(emailAccountLimits), "The mailbox's daily limit is reached — continues next working day");
    return;
  }

  // Rate, not just volume: keep this account's sends spaced across the working window
  // rather than racing to exhaust the daily cap in one burst.
  const paceUntil = emailPaceGate(db, emailAccountId, emailAccountLimits, sentTodayActual, hardLimit);
  if (paceUntil) {
    log(db, runId, target.id, "info", `Pacing ${name} — next send window for ${emailAccountId} at ${paceUntil}`);
    trReschedule(db, tr, paceUntil, "Spacing out this mailbox's sends");
    return;
  }

  // A subject the AI wrote (here or in an approved agent draft) for a follow-up would start a new
  // thread in Gmail; only a subject the user typed on the step is kept for a follow-up.
  const aiSubject = !queuedJob && (!!approvedEmail || !!step.ai_enabled);
  let finalEmailBody = emailBody;
  let threading: { replyToMessageId?: string; references?: string[] } = {};
  let headers: Record<string, string> | undefined;
  if (!queuedJob) {
    // Step-level signature takes precedence; null means fall back to email account default
    const rawSig = (step.email_signature !== null ? step.email_signature : emailAccount.signature)?.trim();
    const sig = rawSig ? signatureText(rawSig) : "";
    let composed = sig ? `${emailBody}\n\n--\n${sig}` : emailBody;
    // The sender's "Unsubscribe link: Included" adds a footer link when the copy has none of its own.
    if (emailAccount.include_unsubscribe && !/\{\{\s*unsubscribe_url/i.test(composed)) {
      // No public link can be built (no APP URL configured): an opt-out by reply still works,
      // and the reply classifier honours it, so say so instead of dropping the footer.
      composed += unsubscribeUrl(target.workspace_id, freshTarget.email) ? "\n\nUnsubscribe: {{unsubscribe_url}}" : "\n\nTo stop receiving these emails, reply \"unsubscribe\".";
    }
    if (emailAccount.include_unsubscribe && emailAccount.postal_address?.trim()) composed += `\n${emailAccount.postal_address.trim()}`;
    finalEmailBody = applyUnsubscribeVariable(composed, target.workspace_id, freshTarget.email);
    // A placeholder that survived rendering ({{frist_name}}, a deleted custom field) would go
    // out literally. Fail the step with the culprit named instead.
    const unresolved = findUnresolvedTokens(`${emailSubject}\n${finalEmailBody}`);
    if (unresolved.length > 0) {
      log(db, runId, target.id, "error", `Email to ${name} not sent — unresolved template variables: ${unresolved.join(", ")}`);
      trFail(db, tr, `Unresolved template variables: ${unresolved.join(", ")}`);
      return;
    }
    // Follow-ups thread onto the earlier emails of this sequence. A blank or AI-written subject
    // reuses "Re: <first subject>" (Gmail only threads on a matching subject); a follow-up
    // subject the user typed is kept, with the threading headers still set.
    const prior = db.prepare(`SELECT sm.message_id, sm.subject FROM sent_messages sm JOIN email_jobs ej ON ej.id = sm.job_id
      WHERE ej.source = 'campaign' AND ej.run_id = ? AND ej.target_id = ? AND sm.email_account_id = ? AND ej.idempotency_key <> ?
      ORDER BY sm.accepted_at, sm.rowid`).all(runId, target.id, emailAccountId, idempotencyKey) as Array<{ message_id: string; subject: string }>;
    if (prior.length > 0) {
      threading = { replyToMessageId: prior[prior.length - 1].message_id, references: prior.map((p) => p.message_id) };
      if (!emailSubject.trim() || aiSubject) {
        const first = prior[0].subject.trim();
        emailSubject = /^re:/i.test(first) ? first : `Re: ${first}`;
      }
    }
    const listUnsubscribe = unsubscribeHeaders(target.workspace_id, freshTarget.email, emailAccount.reply_to || emailAccount.from_email);
    headers = Object.keys(listUnsubscribe).length ? listUnsubscribe : undefined;
  }
  // Last look before handing over: writing the email can take a while, and a reply (or a stop)
  // may have arrived meanwhile. Nothing is sent to someone who already answered.
  if (stoppedSinceClaim(db, tr.id)) {
    log(db, runId, target.id, "info", `${name} replied or was stopped while the email was being prepared — not sending`);
    return;
  }
  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending email to ${name} <${freshTarget.email}>`);
  try {
    await sendEmailDurably({
      workspaceId: target.workspace_id,
      emailAccountId,
      idempotencyKey,
      source: "campaign",
      targetId: target.id,
      runId,
      stepId: step.id,
      variantId: emailVariantId ?? undefined,
      to: freshTarget.email,
      subject: emailSubject,
      body: finalEmailBody,
      // Open tracking needs HTML: the step's own setting, or the sender's "Open tracking: Enabled".
      deliveryMode: step.email_delivery_mode === "enhanced" || emailAccount.track_opens ? "enhanced" : "plain",
      trackOpens: (step.email_delivery_mode === "enhanced" && step.email_track_opens === 1) || !!emailAccount.track_opens,
      trackClicks: step.email_delivery_mode === "enhanced" && step.email_track_clicks === 1,
      ...threading,
      headers,
    });
  } catch (err) {
    // Transient provider error: the job is kept and this step re-sends it once due, back
    // through the working-hours, daily-cap and pacing gates above. The track stays on this
    // step; a permanent failure (retries exhausted) still throws and fails the track.
    if (err instanceof EmailRetryScheduledError) {
      log(db, runId, target.id, "warn", `Email to ${name} hit a temporary error (${err.message}) — retrying after ${err.retryAt}`);
      trReschedule(db, tr, err.retryAt, "The mail server asked to retry later");
      return;
    }
    throw err;
  }
  db.transaction(() => {
    consumeDraft(db, approvedEmail);
    if (tr.pending_reply_context) db.prepare("UPDATE run_profile_tracks SET pending_reply_context = NULL WHERE id = ?").run(tr.id);
    trRecordContext(db, tr, { emailSubject, emailBody });
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `Email sent to ${name}`);
  })();
}

/** The track was stopped, or the lead replied since enrolling, after this step started. */
export function stoppedSinceClaim(db: ReturnType<typeof import("@/lib/db").getDb>, trackId: string): boolean {
  const row = db.prepare(`SELECT rt.state, t.email_replied_at, t.last_replied_at, rp.created_at enrolled_at FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN targets t ON t.id = rp.target_id WHERE rt.id = ?`).get(trackId) as
    { state: string; email_replied_at: string | null; last_replied_at: string | null; enrolled_at: string | null } | undefined;
  if (!row || row.state !== "in_progress") return true;
  const ms = (v: string | null) => (v ? Date.parse(/[TZ]/.test(v) ? v : `${v.replace(" ", "T")}Z`) : NaN);
  const since = ms(row.enrolled_at);
  return [row.email_replied_at, row.last_replied_at].some((at) => !!at && (Number.isNaN(since) || ms(at) >= since));
}
