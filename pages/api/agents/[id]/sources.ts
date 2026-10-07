import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { addSource, deleteSource, getAgent, listSources, updateSource } from "@/lib/agents/store";
import { isSourceType } from "@/lib/signals/types";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET    /api/agents/:id/sources
// POST   /api/agents/:id/sources { source_type, config, interval_hours }
// PATCH  /api/agents/:id/sources { source_id, config?, enabled?, interval_hours? }
// DELETE /api/agents/:id/sources?source_id=
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  const agentId = String(req.query.id);
  if (!getAgent(agentId, ctx.workspaceId)) return res.status(404).json({ error: "Agent not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    if (req.method === "GET") return res.json(listSources(agentId, ctx.workspaceId));
    if (req.method === "POST") {
      if (!isSourceType(body.source_type)) return res.status(400).json({ error: "Unknown source_type" });
      const source = addSource(agentId, ctx.workspaceId, body.source_type, body.config ?? {}, Number(body.interval_hours ?? 12));
      recordAudit(ctx, "agent.source_added", "agent_source", source.id, { type: body.source_type });
      return res.status(201).json(source);
    }
    if (req.method === "PATCH") {
      const sourceId = String(body.source_id ?? "");
      const updated = updateSource(sourceId, ctx.workspaceId, {
        config: body.config, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        interval_hours: body.interval_hours !== undefined ? Number(body.interval_hours) : undefined,
      });
      if (!updated || updated.agent_id !== agentId) return res.status(404).json({ error: "Source not found" });
      return res.json(updated);
    }
    if (req.method === "DELETE") {
      deleteSource(String(req.query.source_id ?? ""), ctx.workspaceId);
      return res.status(204).end();
    }
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: firstIssue(err, "Invalid source config") });
    throw err;
  }
  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end();
}
