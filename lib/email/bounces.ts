import { getDb } from "@/lib/db";
import { recordInboundBounce } from "@/lib/email/infrastructure";
import { BOUNCE_SENDER_PATTERNS } from "@/lib/email/reply-attribution";

/**
 * Act on one DSN's candidate recipients. Everything is scoped to the workspace that owns
 * the mailbox the DSN arrived in: a bounce landing in tenant A's inbox must never look up,
 * suppress, or invalidate tenant B's contacts, even when they share an address. Only the
 * bounced address itself is marked invalid — one hard bounce says nothing about other
 * people at the same company, so colleagues and the company row are left untouched.
 * Returns the number of newly recorded bounces (0 or 1).
 */
export function applyBounceCandidates(db: ReturnType<typeof getDb>, input: {
  account: { workspace_id: string; from_email: string | null };
  emailAccountId: string;
  dsnMessageId: string;
  authoritative: string;
  candidates: string[];
  ourAddresses: Set<string>;
}): number {
  const { account, emailAccountId, dsnMessageId, authoritative, ourAddresses } = input;
  for (const candidate of input.candidates) {
    if (BOUNCE_SENDER_PATTERNS.some(p => p.test(candidate))) continue;
    // Never suppress ourselves: our own from_email appears in most DSN bodies
    // (it was the original sender), and suppressing it would silently kill the
    // mailbox for every future send.
    if (ourAddresses.has(candidate)) continue;

    const target = db
      .prepare("SELECT id, email_status, company_id FROM targets WHERE workspace_id = ? AND lower(email) = ?")
      .get(account.workspace_id, candidate) as { id: string; email_status: string | null; company_id: string | null } | undefined;

    // The Final-Recipient is trustworthy on its own. Anything merely scraped
    // out of the body is only acted on when it matches a contact we know, which
    // is what keeps quoted third-party addresses out of the suppression list.
    const trusted = candidate === authoritative;
    if (!trusted && !target) continue;

    // Recorded even when the contact is already invalid, and even when there is
    // no contact row at all. The suppression entry and the sender-health event
    // are the durable half of this — `targets.email_status` is per-contact and
    // does not survive a re-import, which is how a dead address gets re-sent to.
    const outcome = recordInboundBounce({
      workspaceId: account.workspace_id,
      emailAccountId,
      recipient: candidate,
      targetId: target?.id,
      companyId: target?.company_id,
      detail: `Hard bounce received at ${account.from_email ?? emailAccountId}`,
      dedupeKey: `${emailAccountId}:${dsnMessageId}:${candidate}`,
    });
    const recorded = outcome.recorded ? 1 : 0;

    if (!target || target.email_status === "invalid") return recorded;

    const note = `Email bounced on ${new Date().toISOString().slice(0, 10)} — marked invalid`;
    db.prepare(`
      UPDATE targets SET email_status = 'invalid',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
      WHERE id = ? AND workspace_id = ?
    `).run(note, note, target.id, account.workspace_id);

    db.prepare(`
      UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Email bounced — invalid address'
      WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
      AND state IN ('pending', 'in_progress')
    `).run(target.id);

    console.log(`[email-inbox] Bounce for ${candidate} (target ${target.id}) — suppressed and marked invalid`);
    return recorded;
  }
  return 0;
}
