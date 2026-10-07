import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { isAiConfigured, AiNotConfiguredError } from "@/lib/ai/client";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { ingestSignal } from "@/lib/platform/signals";
import { emitDomainEvent } from "@/lib/platform/events";
import { communityAi } from "@/lib/community-ai";
import { scoreNewLeads } from "@/lib/agents/fit";
import { draftChannels, queueDraft, strongestSignals, writeFirstTouch } from "@/lib/agents/drafts";
import { autoApproveDue } from "@/lib/agents/approvals";
import { enrollLead, workflowChannels } from "@/lib/agents/enroll";
import { enrichTargetEmail } from "@/lib/enrichment/waterfall";
import type { Agent } from "@/lib/agents/store";

/**
 * The agent loop. Per active agent, each pass:
 *   1. adopts list members it hasn't seen (lookalike imports, manual adds),
 *   2. scores new leads (fit x intent) and qualifies them on the agent's threshold,
 *   3. finds emails for qualified leads when the campaign has an email track,
 *   4. drafts signal-aware first touches into the approval queue (up to the daily cap),
 *   5. auto-approves due drafts in autopilot, which enrolls the lead in the campaign.
 * No LinkedIn browser work happens here, so it runs on its own loop beside outreach.
 */

export interface AgentPassResult { adopted: number; scored: number; enriched: number; drafted: number; enrolled: number; autoApproved: number }

/** Leads that entered the approval queue or the campaign today count against the daily cap. */
export function handledToday(db: Database.Database, agentId: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status IN ('drafted','enrolled','approved')
    AND agent_status_at >= date('now')`).get(agentId) as { n: number }).n;
}

function adoptListMembers(db: Database.Database, agent: Agent): number {
  if (!agent.list_id) return 0;
  const rows = db.prepare(`SELECT t.id FROM list_targets lt JOIN targets t ON t.id = lt.target_id
    WHERE lt.list_id = ? AND t.agent_status IS NULL LIMIT 200`).all(agent.list_id) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare("UPDATE targets SET agent_id = COALESCE(agent_id, ?), agent_status = 'new', agent_status_at = datetime('now'), lead_source = COALESCE(lead_source, 'lookalike') WHERE id = ?").run(agent.id, r.id);
    ingestSignal({ workspaceId: agent.workspace_id, targetId: r.id, type: "lookalike", title: "Matches your ideal customer profile", source: "agent:lookalike", agentId: agent.id, dedupeKey: `lookalike:${agent.id}:${r.id}` });
  }
  return rows.length;
}

async function enrichQualified(db: Database.Database, agent: Agent, limit = 5): Promise<number> {
  if (!agent.enrich_emails || !workflowChannels(db, agent.workflow_id).email) return 0;
  const rows = db.prepare(`SELECT id FROM targets WHERE agent_id = ? AND agent_status = 'qualified' AND (email IS NULL OR email = '')
    AND NOT EXISTS (SELECT 1 FROM enrichment_cache ec WHERE ec.identity_key = lower(targets.linkedin_url) AND ec.provider = 'pattern' AND ec.fetched_at > datetime('now','-30 days'))
    ORDER BY lead_score DESC LIMIT ?`).all(agent.id, limit) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) if (await enrichTargetEmail(db, agent.workspace_id, r.id)) n++;
  return n;
}

async function draftQualified(db: Database.Database, agent: Agent, icp: ReturnType<typeof getLatestIcp>): Promise<{ drafted: number; enrolled: number }> {
  const room = agent.daily_lead_cap - handledToday(db, agent.id);
  if (room <= 0) return { drafted: 0, enrolled: 0 };
  const leads = db.prepare(`SELECT id, linkedin_url, email FROM targets WHERE agent_id = ? AND agent_status = 'qualified'
    ORDER BY lead_score DESC LIMIT ?`).all(agent.id, Math.min(room, 10)) as Array<{ id: string; linkedin_url: string | null; email: string | null }>;
  const aiReady = isAiConfigured(agent.workspace_id);
  let drafted = 0; let enrolled = 0;
  for (const lead of leads) {
    const channels = draftChannels(db, agent, lead);
    // Without AI (or with a campaign that has no first message to personalise), the lead
    // goes straight into the campaign in autopilot, or waits for a one-click approve in copilot.
    if (!aiReady || !channels.length) {
      if (agent.mode === "autopilot") { if (enrollLead(db, agent, lead.id).enrolled) enrolled++; }
      else db.prepare("UPDATE targets SET agent_status = 'approved', agent_status_at = datetime('now') WHERE id = ? AND agent_status = 'qualified'").run(lead.id);
      continue;
    }
    const bundle = communityAi.getContactWithCompany(lead.id);
    if (!bundle) continue;
    const signals = strongestSignals(db, lead.id);
    try {
      for (const channel of channels) {
        const draft = await writeFirstTouch(agent, icp?.data ?? null, channel, bundle.contact, bundle.company, signals);
        queueDraft(db, agent, lead.id, channel, draft, signals[0]?.id ?? null);
      }
      db.prepare("UPDATE targets SET agent_status = 'drafted', agent_status_at = datetime('now') WHERE id = ?").run(lead.id);
      emitDomainEvent({ workspaceId: agent.workspace_id, type: "draft.pending", entityType: "contact", entityId: lead.id, payload: { agent_id: agent.id, channels } });
      drafted++;
    } catch (err) {
      if (err instanceof AiNotConfiguredError) break;
      console.warn(`[agents] draft failed for ${lead.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { drafted, enrolled };
}

export async function runAgentPass(agent: Agent): Promise<AgentPassResult> {
  const db = getDb();
  const icp = agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id);
  const result: AgentPassResult = { adopted: 0, scored: 0, enriched: 0, drafted: 0, enrolled: 0, autoApproved: 0 };
  try {
    result.adopted = adoptListMembers(db, agent);
    const beforeQualified = (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status = 'qualified'").get(agent.id) as { n: number }).n;
    result.scored = await scoreNewLeads(db, agent, icp?.data ?? null, icp?.id ?? null);
    const afterQualified = (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status = 'qualified'").get(agent.id) as { n: number }).n;
    if (afterQualified > beforeQualified) emitDomainEvent({ workspaceId: agent.workspace_id, type: "lead.qualified", entityType: "agent", entityId: agent.id, payload: { count: afterQualified - beforeQualified } });
    result.enriched = await enrichQualified(db, agent);
    const d = await draftQualified(db, agent, icp);
    result.drafted = d.drafted;
    result.enrolled = d.enrolled;
    if (agent.mode === "autopilot") result.autoApproved = autoApproveDue(db, agent);
    db.prepare("UPDATE agents SET last_run_at = datetime('now'), last_error = NULL WHERE id = ?").run(agent.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE agents SET last_run_at = datetime('now'), last_error = ? WHERE id = ?").run(message, agent.id);
    console.warn(`[agents] pass failed for ${agent.id}: ${message}`);
  }
  return result;
}

export async function runActiveAgents(): Promise<number> {
  const agents = getDb().prepare("SELECT * FROM agents WHERE status = 'active'").all() as Agent[];
  for (const agent of agents) await runAgentPass(agent);
  return agents.length;
}
