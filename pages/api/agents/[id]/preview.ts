import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { previewLeads, rejectPreviewLead, runPreview } from "@/lib/agents/preview";
import { requireWorkspace } from "@/lib/workspace";

// GET   /api/agents/:id/preview → current top 5 preview leads
// POST  /api/agents/:id/preview → find leads now (up to ~2 min), score them, return the top 5
// PATCH /api/agents/:id/preview { target_id, reason? } → reject one; returns the refreshed top 5
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const db = getDb();
  if (req.method === "GET") return res.json({ leads: previewLeads(db, agent.id) });
  if (req.method === "POST") {
    try {
      return res.json(await runPreview(agent));
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Preview failed", leads: previewLeads(db, agent.id) });
    }
  }
  if (req.method === "PATCH") {
    const targetId = typeof req.body?.target_id === "string" ? req.body.target_id : "";
    if (!targetId) return res.status(400).json({ error: "target_id is required" });
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    return res.json({ leads: rejectPreviewLead(db, agent, targetId, reason) });
  }
  res.setHeader("Allow", ["GET", "POST", "PATCH"]);
  return res.status(405).end();
}

export const config = { maxDuration: 300 };
