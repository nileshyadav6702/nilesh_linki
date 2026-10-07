import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { agentInputSchema, checkAgentRefs, deleteAgent, getAgent, listSources, updateAgent } from "@/lib/agents/store";
import { activateAgentRuns } from "@/lib/agents/enroll";
import { agentCounts, signalFunnel } from "@/lib/agents/analytics";
import { budgetSnapshot } from "@/lib/linkedin/budget";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET /api/agents/:id → agent, sources, last detector runs, counts, funnel, LinkedIn budget
// PATCH /api/agents/:id → update fields or { status: 'active' | 'paused' }
// DELETE /api/agents/:id
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  const db = getDb();
  const id = String(req.query.id);
  const agent = getAgent(id, ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  if (req.method === "GET") {
    const runs = db.prepare(`SELECT dr.*, s.source_type FROM detector_runs dr JOIN agent_sources s ON s.id = dr.agent_source_id
      WHERE s.agent_id = ? ORDER BY dr.started_at DESC LIMIT 20`).all(id);
    return res.json({
      agent, sources: listSources(id, ctx.workspaceId), runs, counts: agentCounts(db, id),
      funnel: signalFunnel(db, ctx.workspaceId, id),
      linkedin_budget: agent.linkedin_account_id ? budgetSnapshot(agent.linkedin_account_id) : null,
    });
  }
  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.status !== undefined && !["active", "paused", "draft"].includes(String(body.status))) return res.status(400).json({ error: "Invalid status" });
    const { status, ...rest } = body;
    const parsed = agentInputSchema.partial().safeParse(rest);
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
    const refError = checkAgentRefs(ctx.workspaceId, parsed.data);
    if (refError) return res.status(400).json({ error: refError });
    if (status === "active") {
      const merged = { ...agent, ...parsed.data };
      if (!merged.workflow_id) return res.status(400).json({ error: "Pick a campaign for the agent before activating it" });
      if (!merged.linkedin_account_id && !merged.email_account_id) return res.status(400).json({ error: "Pick a LinkedIn or email sender before activating" });
    }
    const updated = updateAgent(id, ctx.workspaceId, { ...parsed.data, ...(status ? { status } : {}) });
    if (status === "active" && updated) activateAgentRuns(db, updated);
    if (status === "paused") db.prepare("UPDATE runs SET status = 'paused' WHERE workspace_id = ? AND workflow_id IS ? AND list_id IS ? AND status = 'running'").run(ctx.workspaceId, agent.workflow_id, agent.list_id);
    recordAudit(ctx, "agent.updated", "agent", id, { fields: Object.keys(body) });
    return res.json(updated);
  }
  if (req.method === "DELETE") {
    deleteAgent(id, ctx.workspaceId);
    recordAudit(ctx, "agent.deleted", "agent", id);
    return res.status(204).end();
  }
  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return res.status(405).end();
}
