import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { insightsReport, parsePeriod } from "@/lib/insights/report";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/insights?agent=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD  (default: all agents, last 30 days)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const db = getDb();
  const agent = typeof req.query.agent === "string" && /^[\w-]{1,100}$/.test(req.query.agent) ? req.query.agent : null;
  if (agent && !db.prepare("SELECT 1 FROM agents WHERE id = ? AND workspace_id = ?").get(agent, ctx.workspaceId)) {
    return res.status(404).json({ error: "Agent not found" });
  }
  const period = parsePeriod(req.query.from, req.query.to);
  const agents = db.prepare("SELECT id, name, status FROM agents WHERE workspace_id = ? ORDER BY created_at").all(ctx.workspaceId);
  return res.json({ ...insightsReport(db, ctx.workspaceId, { agentId: agent, period }), agentOptions: agents });
}
