import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { billingSummary } from "@/lib/credits/ledger";
import { sourceItems } from "@/lib/agents/source-items";
import { agentInputSchema, checkAgentRefs, deleteAgent, getAgent, listSources, updateAgent } from "@/lib/agents/store";
import { activateAgentRuns, pauseAgentRuns } from "@/lib/agents/enroll";
import { agentActivity, agentCounts, agentPerformance, agentSeries, dueToday, nextSourceRun, signalFunnel, stepOccupancy } from "@/lib/agents/analytics";
import { budgetSnapshot } from "@/lib/linkedin/budget";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";
import { sequenceSteps } from "@/lib/agents/drafts";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET /api/agents/:id → agent, sources, last detector runs, counts, funnel, LinkedIn budget
// PATCH /api/agents/:id → fields; status (finding leads), outreach_enabled (sending), create_default_campaign
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
      agent, runs, counts: agentCounts(db, id),
      sources: listSources(id, ctx.workspaceId).map((src) => ({
        ...src, leads: (db.prepare("SELECT COALESCE(SUM(ingested), 0) n FROM detector_runs WHERE agent_source_id = ?").get(src.id) as { n: number }).n,
        items: sourceItems(db, src),
      })),
      funnel: signalFunnel(db, ctx.workspaceId, id), sequence: sequenceSteps(db, agent.workflow_id),
      workflow: agent.workflow_id ? db.prepare("SELECT id, name FROM workflows WHERE id = ?").get(agent.workflow_id) ?? null : null,
      linkedin_budget: agent.linkedin_account_id ? budgetSnapshot(agent.linkedin_account_id) : null,
      performance: agentPerformance(db, id),
      // 30 days, so the Overview can switch between 7 and 30 without another request.
      series: agentSeries(db, id, 30),
      activity: agentActivity(db, id, agent.workflow_id),
      next_run_at: nextSourceRun(db, id),
      due_today: dueToday(db, agent.workflow_id),
      steps: stepOccupancy(db, agent.workflow_id),
      // Credit balance, so the Overview can warn before outreach stops for lack of credits.
      credits: (() => { const b = billingSummary(db, ctx.workspaceId); return { balance: b.balance, next_refill: b.next_refill }; })(),
      senders: {
        linkedin: agent.linkedin_account_id ? db.prepare("SELECT id, name, email, daily_connection_limit, daily_message_limit, weekly_connection_limit, weekly_message_limit, working_days, is_authenticated FROM accounts WHERE id = ?").get(agent.linkedin_account_id) ?? null : null,
        email: agent.email_account_id ? db.prepare("SELECT id, from_email, from_name, daily_email_limit, ramp_up_enabled, ramp_start_date FROM email_accounts WHERE id = ?").get(agent.email_account_id) ?? null : null,
      },
      sender_pool: {
        linkedin: (db.prepare("SELECT COUNT(*) n FROM accounts WHERE workspace_id = ?").get(ctx.workspaceId) as { n: number }).n,
        email: (db.prepare("SELECT COUNT(*) n FROM email_accounts WHERE workspace_id = ?").get(ctx.workspaceId) as { n: number }).n,
      },
    });
  }
  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.status !== undefined && !["active", "paused", "draft"].includes(String(body.status))) return res.status(400).json({ error: "Invalid status" });
    const { status, outreach_enabled, create_default_campaign: _create, ...rest } = body;
    void _create;
    const parsed = agentInputSchema.partial().safeParse(rest);
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
    // zod fills defaults for absent keys even under .partial(); keep only what was sent so a
    // PATCH never silently resets other settings.
    const fields = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => k in rest)) as typeof parsed.data;
    const refError = checkAgentRefs(ctx.workspaceId, fields);
    if (refError) return res.status(400).json({ error: refError });
    if (body.create_default_campaign && !fields.workflow_id) {
      const channel = (fields.channel ?? agent.channel) as "linkedin" | "multi" | "email";
      const hasEmail = !!(fields.email_account_id ?? agent.email_account_id);
      fields.workflow_id = createDefaultCampaign(db, ctx.workspaceId, `${fields.name ?? agent.name} · signal outreach`, hasEmail ? channel : channel === "email" ? "email" : "linkedin");
    }
    const merged = { ...agent, ...fields };
    // status = finding leads (discovery, scoring, drafting); outreach_enabled = sending.
    if (outreach_enabled === true) {
      if (!merged.workflow_id) return res.status(400).json({ error: "Create this agent's sequence before starting outreach" });
      if (!merged.linkedin_account_id && !merged.email_account_id) return res.status(400).json({ error: "Pick a LinkedIn or email sender before starting outreach" });
    }
    const patch: Record<string, unknown> = { ...fields };
    if (status !== undefined) patch.status = status;
    if (typeof outreach_enabled === "boolean") patch.outreach_enabled = outreach_enabled;
    const updated = updateAgent(id, ctx.workspaceId, patch);
    if (updated && outreach_enabled === true) activateAgentRuns(db, updated);
    if (updated && outreach_enabled === false) pauseAgentRuns(db, updated);
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
