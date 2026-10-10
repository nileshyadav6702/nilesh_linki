import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { configWithItems, itemKeys } from "@/lib/agents/source-items";
import { getAgent, listSources, sourceNeedsLinkedIn } from "@/lib/agents/store";
import { runAgentPass } from "@/lib/agents/loop";
import { runSource } from "@/lib/signals/engine";
import { requireWorkspace } from "@/lib/workspace";
import { CREDIT_COSTS, debit, InsufficientCreditsError, refund } from "@/lib/credits/ledger";

// POST /api/agents/:id/run → run now: non-LinkedIn sources immediately, LinkedIn sources
// queued for the runner's next discovery pass (they must share the browser session), then
// one scoring/drafting pass. Costs CREDIT_COSTS.agent_launch (scheduled runs are free),
// refunded when the run fails.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const db = getDb();
  // ?source_id= runs just that source ("Launch now" on one row).
  const only = typeof req.query.source_id === "string" ? req.query.source_id : null;
  // &item= narrows that source to one tracked competitor / topic / board / list (Launch now on an item row).
  const item = only && typeof req.query.item === "string" ? req.query.item : null;
  let sources = listSources(agent.id, ctx.workspaceId).filter((s) => s.enabled && (!only || s.id === only));
  if (only && !sources.length) return res.status(404).json({ error: "Source not found or turned off" });
  if (item) {
    if (!itemKeys(sources[0]).includes(item)) return res.status(404).json({ error: "That signal is no longer tracked by this source" });
    sources = [{ ...sources[0], config_json: JSON.stringify(configWithItems(sources[0], (k) => k === item)) }];
  }

  const cost = CREDIT_COSTS.agent_launch;
  try {
    debit(db, ctx.workspaceId, { type: "agent_launch", credits: cost, userId: ctx.userId, refId: agent.id, note: only ? "One lead source" : null });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return res.status(402).json({ error: err.message, code: "insufficient_credits" });
    throw err;
  }
  try {
    const http: Array<{ source_type: string; ingested: number; error: string | null }> = [];
    let queued = 0;
    for (const s of sources) {
      if (sourceNeedsLinkedIn(s.source_type)) {
        db.prepare("UPDATE agent_sources SET next_run_at = datetime('now') WHERE id = ?").run(s.id);
        queued++;
      } else {
        const r = await runSource(s);
        http.push({ source_type: s.source_type, ingested: r.ingested, error: r.error });
      }
    }
    const pass = only ? null : await runAgentPass(agent);
    return res.json({ credits_used: cost, linkedin_sources_queued: queued, http_sources: http, pass, note: agent.status !== "active" && queued ? "LinkedIn sources run only while the agent is active" : undefined });
  } catch (err) {
    refund(db, ctx.workspaceId, "agent_launch", cost, { userId: ctx.userId, refId: agent.id });
    throw err;
  }
}

export const config = { maxDuration: 300 };
