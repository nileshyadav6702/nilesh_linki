import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";
import { agentForWorkflow, generateFixedMessage, previewAiStep, renderForLead } from "@/lib/agents/step-ai";
import { decryptSecret } from "@/lib/crypto";
import { sendEmail } from "@/lib/email/sender";
import { sendOAuthEmail } from "@/lib/email/oauth";
import { toPlainText } from "@/lib/email/content";

// POST /api/workflows/:id/steps/:stepId/ai
//   { action: "preview", target_id, ai_template_id? }            → the AI message for a sample lead (nothing saved)
//   { action: "generate", kind: "message" | "email" | "note" }    → a "same for everyone" draft with {{variables}}
//   { action: "test_email", target_id, mode: "ai" | "fixed", subject?, body?, ai_template_id? } → sends it to you
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), target_id: z.string().min(1), ai_template_id: z.string().nullable().optional() }),
  z.object({ action: z.literal("generate"), kind: z.enum(["message", "email", "note"]) }),
  z.object({
    action: z.literal("test_email"), target_id: z.string().min(1), mode: z.enum(["ai", "fixed"]),
    subject: z.string().max(300).optional(), body: z.string().max(20000).optional(), ai_template_id: z.string().nullable().optional(),
  }),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const workflowId = String(req.query.id);
  if (!requireWorkspaceEntity(res, ctx, "workflows", workflowId)) return;
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const input = parsed.data;
  const db = getDb();
  const agent = agentForWorkflow(db, ctx.workspaceId, workflowId);
  if (!agent) return res.status(404).json({ error: "This campaign isn't attached to an agent" });
  const stepId = String(req.query.stepId);

  try {
    if (input.action === "generate") return res.json(await generateFixedMessage(agent, input.kind));
    if (!requireWorkspaceEntity(res, ctx, "targets", input.target_id)) return;
    if (input.action === "preview") return res.json(await previewAiStep(db, agent, stepId, input.target_id, input.ai_template_id));

    // Test email: built for the sample lead, sent to you from the agent's mailbox (not counted against its daily cap).
    const account = agent.email_account_id ? db.prepare("SELECT * FROM email_accounts WHERE id = ? AND workspace_id = ?").get(agent.email_account_id, ctx.workspaceId) as Record<string, unknown> | undefined : undefined;
    if (!account) return res.status(400).json({ error: "Add an email sender to this agent first (Settings → Senders)" });
    const me = db.prepare("SELECT email FROM users WHERE id = ?").get(ctx.userId) as { email: string } | undefined;
    if (!me?.email) return res.status(400).json({ error: "Your account has no email address" });
    const msg = input.mode === "ai"
      ? await previewAiStep(db, agent, stepId, input.target_id, input.ai_template_id)
      : { subject: renderForLead(db, ctx.workspaceId, input.target_id, input.subject ?? ""), body: renderForLead(db, ctx.workspaceId, input.target_id, input.body ?? "") };
    if (!msg.body.trim()) return res.status(400).json({ error: "Write the email first" });
    const subject = `[Test] ${msg.subject?.trim() || "(no subject)"}`;
    const text = toPlainText(msg.body);
    const domain = String(account.from_email ?? "kairo.local").split("@")[1] || "kairo.local";
    const messageId = `<test-${randomUUID()}@${domain}>`;
    if (account.provider === "gmail" || account.provider === "microsoft") {
      await sendOAuthEmail({ connectionId: String(account.oauth_connection_id), fromName: (account.from_name as string | null) ?? null, to: me.email, subject, body: text, messageId });
    } else {
      await sendEmail({ ...account, password: decryptSecret(String(account.password ?? "")) ?? "" } as unknown as Parameters<typeof sendEmail>[0], me.email, subject, text, { messageId });
    }
    return res.json({ ok: true, to: me.email });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Something went wrong" });
  }
}
