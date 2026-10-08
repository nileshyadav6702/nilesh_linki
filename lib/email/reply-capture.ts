import Imap from "imap";
import { simpleParser } from "mailparser";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { emitDomainEvent } from "@/lib/platform/events";

/**
 * Fetches the body + headers for a given UID and inserts a row into `email_replies`.
 *
 * Idempotent on the message, not on the contact: the same message is recognised by its
 * Message-ID (falling back to sender + timestamp), so re-ingestion is blocked even when the
 * contact it was filed under has been deleted and recreated under a new id. A row that is
 * already stored but detached from any contact is RE-LINKED to `targetId` rather than skipped
 * — that is the path that brings a reply back into the inbox after the contact is recreated.
 * Best-effort: errors are swallowed by the caller.
 */
export function captureReplyBody(
  imap: Imap,
  db: ReturnType<typeof getDb>,
  targetId: string,
  fromEmail: string,
  uid: number,
  emailAccountId: string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    // Fetch the full raw RFC822 message — mailparser handles MIME multipart,
    // base64 / quoted-printable transfer encodings, and charset decoding. The
    // old HEADER+TEXT regex approach stored raw base64 / =XX escapes for the
    // common German auto-reply formats, feeding the classifier garbage.
    const fetch = imap.fetch(uid, { bodies: [""], struct: false });

    const chunks: Buffer[] = [];

    fetch.on("message", (msg) => {
      msg.on("body", (stream) => {
        stream.on("data", (c: Buffer) => chunks.push(c));
      });
    });

    fetch.once("error", () => resolve(null));
    fetch.once("end", () => {
      void (async () => {
        try {
          const raw = Buffer.concat(chunks);

          // Never let a warmup message (or its auto-reply) enter the reply inbox — the
          // inbox is for campaign replies only. Warmup mail carries these headers.
          if (raw.toString("latin1", 0, 8000).match(/^X-Linki-Warmup(-Reply-To|-ID)?:/im)) {
            resolve(null);
            return;
          }

          const parsed = await simpleParser(raw);

          const subject = parsed.subject ?? null;
          const parsedFrom =
            parsed.from?.value?.[0]?.address?.toLowerCase().trim() || fromEmail.toLowerCase();
          const receivedAt = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

          // Prefer decoded plain text; fall back to stripping the HTML part.
          const rawText =
            parsed.text ??
            (parsed.html ? parsed.html.replace(/<[^>]+>/g, " ") : "");
          const bodyText = rawText
            .replace(/\r\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]{2,}/g, " ")
            .trim()
            .slice(0, 16_000);

          if (!bodyText) { resolve(null); return; }

          const messageId = parsed.messageId?.trim() || null;
          const targetRow = db.prepare("SELECT workspace_id FROM targets WHERE id = ?").get(targetId) as { workspace_id: string } | undefined;

          // Identify the MESSAGE, never the contact. Message-ID is the mail system's own
          // identifier and survives the contact being deleted and recreated; sender +
          // timestamp is the fallback for the (rare) message that carries no Message-ID.
          const existing = (messageId
            ? db.prepare("SELECT id, target_id FROM email_replies WHERE email_account_id = ? AND message_id = ?").get(emailAccountId, messageId)
            : db.prepare("SELECT id, target_id FROM email_replies WHERE email_account_id = ? AND from_email = ? AND received_at = ?").get(emailAccountId, parsedFrom, receivedAt)
          ) as { id: string; target_id: string | null } | undefined;

          if (existing) {
            // Already filed against a live contact — a genuine duplicate, nothing to do.
            if (existing.target_id) { resolve(null); return; }
            // Detached (its contact was deleted). Re-attach it and hand it back so the
            // classifier runs against the contact it now belongs to.
            db.prepare("UPDATE email_replies SET target_id = ?, workspace_id = COALESCE(workspace_id, ?) WHERE id = ?")
              .run(targetId, targetRow?.workspace_id ?? null, existing.id);
            console.log(`[email-inbox] Re-linked detached reply ${existing.id} to target ${targetId}`);
            resolve(existing.id);
            return;
          }

          // Look up the most recent active run for this target — the dispatcher needs
          // it to find the email track to reschedule / enroll a substitute into.
          const runRow = db.prepare(
            `SELECT r.id FROM runs r
             JOIN run_profiles rp ON rp.run_id = r.id
             WHERE rp.target_id = ? AND r.status IN ('running', 'paused')
             ORDER BY r.created_at DESC LIMIT 1`
          ).get(targetId) as { id: string } | undefined;

          const replyId = randomUUID();
          db.prepare(
            `INSERT INTO email_replies (id, workspace_id, target_id, run_id, email_account_id, from_email, subject, body_text, received_at, message_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(replyId, targetRow?.workspace_id ?? null, targetId, runRow?.id ?? null, emailAccountId, parsedFrom, subject, bodyText, receivedAt, messageId);
          if (targetRow?.workspace_id) emitDomainEvent({ workspaceId: targetRow.workspace_id, type: "reply.received", entityType: "email_reply", entityId: replyId, payload: { target_id: targetId, from_email: parsedFrom, subject, received_at: receivedAt } });
          resolve(replyId);
        } catch (err) {
          console.warn(`[email-inbox] captureReplyBody parse/insert failed:`, err);
          resolve(null);
        }
      })();
    });
  });
}
