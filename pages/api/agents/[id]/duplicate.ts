import type { NextApiRequest, NextApiResponse } from "next";
import { duplicateAgent } from "@/lib/agents/store";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// POST /api/agents/:id/duplicate → a draft copy with the same ICP, sources, and steps. Leads stay put.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const copy = duplicateAgent(String(req.query.id), ctx.workspaceId);
  if (!copy) return res.status(404).json({ error: "Agent not found" });
  recordAudit(ctx, "agent.duplicated", "agent", copy.id, { from: String(req.query.id) });
  return res.status(201).json(copy);
}
