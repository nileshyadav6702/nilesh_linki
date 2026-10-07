import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decideDraft, saveDraft } from "@/lib/agents/approvals";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// PATCH /api/approvals/:id { decision: 'approve' | 'reject' | 'save', subject?, body? }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") { res.setHeader("Allow", ["PATCH"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const b = (req.body ?? {}) as { decision?: unknown; subject?: unknown; body?: unknown };
  if (b.decision !== "approve" && b.decision !== "reject" && b.decision !== "save") return res.status(400).json({ error: "decision must be approve, reject or save" });
  const edits = {
    subject: typeof b.subject === "string" ? b.subject.slice(0, 200) : undefined,
    body: typeof b.body === "string" ? b.body.slice(0, 4000) : undefined,
  };
  const id = String(req.query.id);
  if (b.decision === "save") {
    const saved = saveDraft(getDb(), ctx.workspaceId, id, edits);
    if (!saved.ok) return res.status(saved.error === "Draft not found" ? 404 : 409).json({ error: saved.error });
    return res.json(saved);
  }
  const result = decideDraft(getDb(), ctx.workspaceId, id, b.decision, ctx.userId, edits);
  if (!result.ok) return res.status(result.error === "Draft not found" ? 404 : 409).json({ error: result.error });
  recordAudit(ctx, `draft.${b.decision}d`, "approval_queue", id, { edited: edits.body !== undefined });
  return res.json(result);
}
