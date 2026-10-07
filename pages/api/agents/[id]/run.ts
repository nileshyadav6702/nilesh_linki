import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent, listSources } from "@/lib/agents/store";
import { runAgentPass } from "@/lib/agents/loop";
import { runSource } from "@/lib/signals/engine";
import { SOURCE_TYPES } from "@/lib/signals/types";
import { requireWorkspace } from "@/lib/workspace";

// POST /api/agents/:id/run → run now: non-LinkedIn sources immediately, LinkedIn sources
// queued for the runner's next discovery pass (they must share the browser session), then
// one scoring/drafting pass.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const db = getDb();
  // ?source_id= runs just that source ("Launch now" on one row).
  const only = typeof req.query.source_id === "string" ? req.query.source_id : null;
  const sources = listSources(agent.id, ctx.workspaceId).filter((s) => s.enabled && (!only || s.id === only));
  const http: Array<{ source_type: string; ingested: number; error: string | null }> = [];
  let queued = 0;
  for (const s of sources) {
    if (SOURCE_TYPES[s.source_type].needsLinkedIn) {
      db.prepare("UPDATE agent_sources SET next_run_at = datetime('now') WHERE id = ?").run(s.id);
      queued++;
    } else {
      const r = await runSource(s);
      http.push({ source_type: s.source_type, ingested: r.ingested, error: r.error });
    }
  }
  const pass = only ? null : await runAgentPass(agent);
  return res.json({ linkedin_sources_queued: queued, http_sources: http, pass, note: agent.status !== "active" && queued ? "LinkedIn sources run only while the agent is active" : undefined });
}

export const config = { maxDuration: 300 };
