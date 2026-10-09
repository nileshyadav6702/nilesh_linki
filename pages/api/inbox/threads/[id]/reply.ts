import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { MailboxDailyCapError } from "@/lib/email/daily-cap";
import { sendEmailDurably } from "@/lib/email/infrastructure";
import { addMessages, upsertThread } from "@/lib/inbox/store";
import { isAddressSuppressed } from "@/lib/platform/suppression";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// POST /api/inbox/threads/:id/reply { body } → answer in the conversation (LinkedIn or email)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  if (!body) return res.status(400).json({ error: "Write a message first" });
  const db = getDb();
  const id = String(req.query.id);
  const t = db.prepare("SELECT * FROM inbox_threads WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId) as Record<string, string | number | null> | undefined;
  if (!t) return res.status(404).json({ error: "Conversation not found" });
  const now = new Date().toISOString();
  try {
    if (t.channel === "linkedin") {
      const { sendLinkedInReply } = await import("@/lib/inbox/linkedin-sync");
      await sendLinkedInReply(id, body);
    } else {
      const to = String(t.participant_email ?? "");
      if (!to) return res.status(400).json({ error: "This conversation has no address to reply to" });
      if (isAddressSuppressed(ctx.workspaceId, to)) return res.status(409).json({ error: "This address has unsubscribed or bounced" });
      const parent = db.prepare("SELECT external_id FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY sent_at DESC LIMIT 1").get(id) as { external_id: string } | undefined;
      const subject = String(t.subject ?? "");
      await sendEmailDurably({
        workspaceId: ctx.workspaceId, emailAccountId: String(t.account_id), idempotencyKey: `inbox-thread:${id}:${randomUUID()}`, source: "team_inbox",
        to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body, replyToMessageId: parent?.external_id.includes("@") ? parent.external_id : undefined,
      });
    }
    addMessages(db, id, [{ externalId: `local:${randomUUID()}`, direction: "out", senderName: "You", bodyText: body, sentAt: now }]);
    upsertThread(db, { workspaceId: ctx.workspaceId, channel: t.channel as "linkedin" | "email", accountId: String(t.account_id), externalId: String(t.external_id), snippet: body.slice(0, 200), lastMessageAt: now });
    recordAudit(ctx, "inbox.reply_sent", "inbox_thread", id, { channel: t.channel });
    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof MailboxDailyCapError) return res.status(429).json({ error: err.message });
    const msg = err instanceof Error ? err.message : "Send failed";
    return res.status(/busy/i.test(msg) ? 409 : 502).json({ error: msg });
  }
}
