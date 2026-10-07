import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { draftReply } from "@/lib/agents/reply-draft";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { requireWorkspace } from "@/lib/workspace";

// GET  /api/inbox/:replyId/draft → latest AI draft for this reply, if any
// POST /api/inbox/:replyId/draft → generate a new draft (never sends)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();
  const replyId = String(req.query.replyId);
  if (req.method === "GET") {
    const draft = db.prepare("SELECT id, body, kind, created_at FROM reply_drafts WHERE reply_id = ? AND workspace_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1").get(replyId, ctx.workspaceId);
    return res.json({ draft: draft ?? null });
  }
  if (req.method === "POST") {
    try {
      return res.json({ draft: await draftReply(db, ctx.workspaceId, replyId) });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) return res.status(400).json({ error: err.message });
      const message = err instanceof Error ? err.message : "Draft failed";
      return res.status(message === "Reply not found" ? 404 : 502).json({ error: message });
    }
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
