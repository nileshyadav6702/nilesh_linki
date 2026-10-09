import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// POST /api/inbox/compose { account_id, target_id, body } → a new LinkedIn message to a contact
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const b = (req.body ?? {}) as { account_id?: string; target_id?: string; body?: string };
  const body = (b.body ?? "").trim().slice(0, 8000);
  if (!b.account_id || !b.target_id || !body) return res.status(400).json({ error: "Choose a contact and write a message" });
  const accountId = b.account_id;
  const db = getDb();
  const acc = db.prepare("SELECT id FROM accounts WHERE id = ? AND workspace_id = ? AND is_authenticated = 1").get(accountId, ctx.workspaceId);
  const target = db.prepare("SELECT id, full_name FROM targets WHERE id = ? AND workspace_id = ?").get(b.target_id, ctx.workspaceId) as { id: string; full_name: string | null } | undefined;
  if (!acc) return res.status(400).json({ error: "Pick a connected LinkedIn account" });
  if (!target?.full_name) return res.status(400).json({ error: "This contact has no name to search on LinkedIn" });
  const name = target.full_name;
  try {
    const { withAccountSession } = await import("@/lib/linkedin/account-session");
    const { getSessionPage, saveSessionState } = await import("@/lib/linkedin/session");
    const { sendMessage } = await import("@/lib/linkedin/message");
    await withAccountSession(accountId, async () => {
      const page = await getSessionPage(accountId);
      try { await sendMessage(page, name, body); } finally { await page.close().catch(() => {}); await saveSessionState(accountId).catch(() => {}); }
    });
    recordAudit(ctx, "inbox.message_sent", "contact", target.id);
    // The new conversation shows up with the next sync of this account.
    void import("@/lib/inbox/sync").then((m) => m.queueInboxSync("linkedin", accountId)).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    const notConnected = /Timeout|waitFor/i.test(msg);
    return res.status(/busy/i.test(msg) ? 409 : 502).json({ error: notConnected ? "LinkedIn could not find this person among your connections. You can message 1st-degree connections only." : msg });
  }
}
