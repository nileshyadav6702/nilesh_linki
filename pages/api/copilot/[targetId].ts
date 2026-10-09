import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decideLead } from "@/lib/agents/approvals";
import { getLeadDetail } from "@/lib/agents/copilot";
import { draftForStep } from "@/lib/agents/copilot-board";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { recordAudit, requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// GET  /api/copilot/:targetId → the contact with its full sequence and drafts
// POST /api/copilot/:targetId { decision: 'approve' | 'reject', reason? } → decide every pending step at once
// POST /api/copilot/:targetId { action: 'generate', step_id } → this step's draft, written now if missing ("View message")
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const targetId = String(req.query.targetId);
  if (!requireWorkspaceEntity(res, ctx, "targets", targetId)) return;
  const db = getDb();
  if (req.method === "GET") return res.json(getLeadDetail(db, ctx.workspaceId, targetId));
  if (req.method === "POST" && req.body?.action === "generate") {
    const stepId = typeof req.body?.step_id === "string" ? req.body.step_id : "";
    if (!stepId) return res.status(400).json({ error: "step_id is required" });
    try {
      return res.json({ draft: await draftForStep(db, ctx.workspaceId, targetId, stepId) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not write the message";
      return res.status(err instanceof AiNotConfiguredError ? 400 : 502).json({ error: message });
    }
  }
  if (req.method === "POST") {
    const decision = req.body?.decision === "approve" ? "approve" : req.body?.decision === "reject" ? "reject" : null;
    if (!decision) return res.status(400).json({ error: "decision must be approve or reject" });
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = decideLead(db, ctx.workspaceId, targetId, decision, ctx.userId, reason);
    if (!result.ok) return res.status(409).json({ error: result.error });
    recordAudit(ctx, `copilot.${decision}`, "contact", targetId);
    return res.json(result);
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
