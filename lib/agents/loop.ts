import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { isAiConfigured, isAiBlockingError } from "@/lib/ai/client";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { companyAlreadyInOutreach, getWorkspacePref } from "@/lib/workspace-prefs";
import { ingestSignal } from "@/lib/platform/signals";
import { emitDomainEvent } from "@/lib/platform/events";
import { communityAi } from "@/lib/community-ai";
import { scoreNewLeads } from "@/lib/agents/fit";
import { draftableSteps, queueDraft, strongestSignals, writeSequence } from "@/lib/agents/drafts";
import { autoApproveDue } from "@/lib/agents/approvals";
import { enrollLead, workflowChannels } from "@/lib/agents/enroll";
import { findEmailCharged } from "@/lib/credits/charge";
import { balance, CREDIT_COSTS, ensureBilling, InsufficientCreditsError } from "@/lib/credits/ledger";
import type { Agent } from "@/lib/agents/store";
import { clearFailure, inBackoff, recordFailure } from "@/lib/agents/backoff";

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
  // Members arrive via Sales Navigator imports (lookalike search or a pasted URL) or by hand.
  const lookalike = !!db.prepare("SELECT 1 FROM agent_sources WHERE agent_id = ? AND source_type = 'lookalike' AND enabled = 1").get(agent.id);
  for (const r of rows) {
    db.prepare("UPDATE targets SET agent_id = COALESCE(agent_id, ?), agent_status = 'new', agent_status_at = datetime('now'), lead_source = COALESCE(lead_source, ?) WHERE id = ?").run(agent.id, lookalike ? "lookalike" : "imported", r.id);
    if (lookalike) ingestSignal({ workspaceId: agent.workspace_id, targetId: r.id, type: "lookalike", title: "Matches your ideal customer profile", source: "agent:lookalike", agentId: agent.id, dedupeKey: `lookalike:${agent.id}:${r.id}` });
  }
  return rows.length;
}

/** Marker row in enrichment_cache recording the last waterfall attempt for a target. */
export const EMAIL_ATTEMPT_PROVIDER = "_attempt";
const EMAIL_ATTEMPT_KEY_SQL = "('target:' || targets.id)";

async function enrichQualified(db: Database.Database, agent: Agent, limit = 5): Promise<number> {
  if (!agent.enrich_emails || !workflowChannels(db, agent.workflow_id).email) return 0;
  // The attempt is keyed on the target, not on a provider's cache row: a lead with no
  // LinkedIn URL, or a workspace without the pattern provider, would otherwise be re-picked
  // forever and starve every lead below the top few. Misses stay cached per provider for 30
  // days, so the daily retry only re-asks providers that errored.
  const rows = db.prepare(`SELECT id FROM targets WHERE agent_id = ? AND agent_status = 'qualified' AND (email IS NULL OR email = '')
    AND NOT EXISTS (SELECT 1 FROM enrichment_cache ec WHERE ec.identity_key = ${EMAIL_ATTEMPT_KEY_SQL} AND ec.provider = '${EMAIL_ATTEMPT_PROVIDER}' AND ec.fetched_at > datetime('now','-1 day'))
    ORDER BY lead_score DESC LIMIT ?`).all(agent.id, limit) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) {
    // Out of credits: stop before marking the attempt, so these leads are picked up after the refill.
    ensureBilling(db, agent.workspace_id);
    if (balance(db, agent.workspace_id) < CREDIT_COSTS.email_enrichment) break;
    db.prepare(`INSERT INTO enrichment_cache (identity_key, provider, fetched_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(identity_key, provider) DO UPDATE SET fetched_at = excluded.fetched_at`).run(`target:${r.id}`, EMAIL_ATTEMPT_PROVIDER);
    try {
      if (await findEmailCharged(db, agent.workspace_id, r.id)) n++;
    } catch (err) {
      if (err instanceof InsufficientCreditsError) break;
      console.warn(`[agents] email enrichment failed for ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return n;
}

async function draftQualified(db: Database.Database, agent: Agent, icp: ReturnType<typeof getLatestIcp>): Promise<{ drafted: number; enrolled: number }> {
  const room = agent.daily_lead_cap - handledToday(db, agent.id);
  if (room <= 0) return { drafted: 0, enrolled: 0 };
  const take = Math.min(room, 10);
  const leads = (db.prepare(`SELECT id, linkedin_url, email, degree, company, company_id FROM targets WHERE agent_id = ? AND agent_status = 'qualified'
    ORDER BY lead_score DESC LIMIT ?`).all(agent.id, take * 3) as Array<{ id: string; linkedin_url: string | null; email: string | null; degree: number | null; company: string | null; company_id: string | null }>)
    .filter((l) => !inBackoff("draft", l.id)).slice(0, take);
  const aiReady = isAiConfigured(agent.workspace_id);
  const companyDedup = getWorkspacePref(db, agent.workspace_id, "company_dedup");
  let drafted = 0; let enrolled = 0;
  for (const lead of leads) {
    if (agent.exclude_first_degree && lead.degree === 1) {
      db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = 'Already a 1st-degree connection', agent_status_at = datetime('now') WHERE id = ?").run(lead.id);
      continue;
    }
    // Workspace preference: one conversation per company at a time.
    if (companyDedup && companyAlreadyInOutreach(db, agent.workspace_id, lead)) {
      db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = 'Someone from this company is already being contacted', agent_status_at = datetime('now') WHERE id = ?").run(lead.id);
      continue;
    }
    const steps = draftableSteps(db, agent, lead);
    const channels = [...new Set(steps.map((s) => s.channel!))];
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
      const written = await writeSequence(agent, icp?.data ?? null, steps, { contact: bundle.contact, company: bundle.company, signals });
      let queued = 0;
      for (const step of steps) {
        const draft = written.get(step.id);
        if (draft) { queueDraft(db, agent, lead.id, step.channel!, draft, signals[0]?.id ?? null, step); queued++; }
      }
      // A lead is only "drafted" when something actually reached the approval queue.
      if (!queued) {
        const attempts = recordFailure("draft", lead.id, "The model returned no draft for any campaign step");
        console.warn(`[agents] no usable drafts for ${lead.id} (attempt ${attempts}); left qualified`);
        continue;
      }
      clearFailure("draft", lead.id);
      db.prepare("UPDATE targets SET agent_status = 'drafted', agent_status_at = datetime('now') WHERE id = ?").run(lead.id);
      emitDomainEvent({ workspaceId: agent.workspace_id, type: "draft.pending", entityType: "contact", entityId: lead.id, payload: { agent_id: agent.id, channels } });
      drafted++;
    } catch (err) {
      // Key, credit or spend cap: every other lead would fail the same way. Stop and surface it.
      if (isAiBlockingError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const attempts = recordFailure("draft", lead.id, message);
      console.warn(`[agents] draft failed for ${lead.id} (attempt ${attempts}):`, message);
    }
  }
  return { drafted, enrolled };
}

export async function runAgentPass(agent: Agent): Promise<AgentPassResult> {
  const db = getDb();
  const icp = agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id);
  const result: AgentPassResult = { adopted: 0, scored: 0, enriched: 0, drafted: 0, enrolled: 0, autoApproved: 0 };
  // Each stage is isolated: a failure in one is recorded and the rest of the pass still runs.
  // An AI key/credit/cap error skips the remaining AI stages (they would fail the same way).
  const errors: string[] = [];
  let aiBlocked = false;
  const stage = async (name: string, fn: () => unknown, needsAi = false) => {
    if (needsAi && aiBlocked) return;
    try { await fn(); } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAiBlockingError(err)) aiBlocked = true;
      errors.push(`${name}: ${message}`);
      console.warn(`[agents] ${name} failed for ${agent.id}: ${message}`);
    }
  };
  await stage("adopt", () => { result.adopted = adoptListMembers(db, agent); });
  await stage("score", async () => {
    const beforeQualified = (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status = 'qualified'").get(agent.id) as { n: number }).n;
    result.scored = await scoreNewLeads(db, agent, icp?.data ?? null, icp?.id ?? null);
    const afterQualified = (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status = 'qualified'").get(agent.id) as { n: number }).n;
    if (afterQualified > beforeQualified) emitDomainEvent({ workspaceId: agent.workspace_id, type: "lead.qualified", entityType: "agent", entityId: agent.id, payload: { count: afterQualified - beforeQualified } });
  }, true);
  await stage("enrich", async () => { result.enriched = await enrichQualified(db, agent); });
  await stage("draft", async () => {
    const d = await draftQualified(db, agent, icp);
    result.drafted = d.drafted;
    result.enrolled = d.enrolled;
  }, true);
  if (agent.mode === "autopilot") await stage("auto-approve", () => { result.autoApproved = autoApproveDue(db, agent); });
  db.prepare("UPDATE agents SET last_run_at = datetime('now'), last_error = ? WHERE id = ?").run(errors.length ? errors.join("; ").slice(0, 1000) : null, agent.id);
  return result;
}

export async function runActiveAgents(): Promise<number> {
  const agents = getDb().prepare("SELECT * FROM agents WHERE status = 'active'").all() as Agent[];
  for (const agent of agents) await runAgentPass(agent);
  return agents.length;
}
