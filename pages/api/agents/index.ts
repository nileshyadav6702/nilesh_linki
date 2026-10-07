import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { addSource, agentInputSchema, checkAgentRefs, createAgent, listAgents } from "@/lib/agents/store";
import { agentCounts } from "@/lib/agents/analytics";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";
import { isSourceType } from "@/lib/signals/types";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET  /api/agents → agents with today's counts
// POST /api/agents → create { ...agent, sources?: [{ source_type, config, interval_hours }] }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "GET") {
    return res.json(listAgents(ctx.workspaceId).map((a) => ({
      ...a,
      counts: agentCounts(db, a.id),
      sources: (db.prepare("SELECT source_type, enabled FROM agent_sources WHERE agent_id = ?").all(a.id) as Array<{ source_type: string; enabled: number }>),
    })));
  }
  if (req.method === "POST") {
    const parsed = agentInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
    const refError = checkAgentRefs(ctx.workspaceId, parsed.data);
    if (refError) return res.status(400).json({ error: refError });
    // Onboarding can ask for a ready-made campaign instead of picking an existing one.
    if (!parsed.data.workflow_id && req.body?.create_default_campaign) {
      parsed.data.workflow_id = createDefaultCampaign(db, ctx.workspaceId, `${parsed.data.name} · signal outreach`, !!parsed.data.email_account_id);
    }
    const sources = Array.isArray(req.body?.sources) ? req.body.sources as Array<{ source_type?: unknown; config?: unknown; interval_hours?: unknown }> : [];
    for (const s of sources) if (!isSourceType(s.source_type)) return res.status(400).json({ error: `Unknown source type: ${String(s.source_type)}` });
    const agent = createAgent(ctx.workspaceId, parsed.data);
    try {
      for (const s of sources) addSource(agent.id, ctx.workspaceId, String(s.source_type), s.config ?? {}, Number(s.interval_hours ?? 12));
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid source", agent });
    }
    recordAudit(ctx, "agent.created", "agent", agent.id);
    return res.status(201).json(agent);
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
