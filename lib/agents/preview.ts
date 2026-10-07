import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { listSources, type Agent } from "@/lib/agents/store";
import { scoreNewLeads } from "@/lib/agents/fit";
import { runSource } from "@/lib/signals/engine";
import { SOURCE_TYPES } from "@/lib/signals/types";
import { discoveryPausedUntil } from "@/lib/linkedin/budget";

/**
 * Wizard "Preview": run the agent's sources once, now, until a small pool of leads exists,
 * score them, and show the best few. Nothing is drafted or sent. Rejected leads are skipped
 * and the next best from the pool takes their place.
 */

const POOL = 15;

export interface PreviewLead {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; location: string | null;
  linkedin_url: string | null; profile_image_url: string | null; lead_score: number | null; fit_verdict: string | null; fit_reason: string | null;
  industry: string | null; employee_count: number | null; signal_title: string | null; signal_type: string | null;
}

export function previewLeads(db: Database.Database, agentId: string, limit = 5): PreviewLead[] {
  return db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.location, t.linkedin_url, t.profile_image_url,
      t.lead_score, t.fit_verdict, t.fit_reason, c.industry, c.employee_count,
      (SELECT s.title FROM signals s WHERE s.target_id = t.id ORDER BY s.occurred_at DESC LIMIT 1) signal_title,
      (SELECT s.type FROM signals s WHERE s.target_id = t.id ORDER BY s.occurred_at DESC LIMIT 1) signal_type
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id
    WHERE t.agent_id = ? AND t.agent_status IN ('new','qualified')
    ORDER BY (t.agent_status = 'qualified') DESC, COALESCE(t.lead_score, t.intent_score) DESC LIMIT ?`).all(agentId, limit) as PreviewLead[];
}

export interface PreviewResult { leads: PreviewLead[]; ran: string[]; errors: string[]; linkedin: "ok" | "no_account" | "paused" | "skipped" }

export async function runPreview(agent: Agent, budgetMs = 120_000): Promise<PreviewResult> {
  const db = getDb();
  const deadline = Date.now() + budgetMs;
  const have = () => (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status IN ('new','qualified')").get(agent.id) as { n: number }).n;
  const sources = listSources(agent.id, agent.workspace_id).filter((s) => s.enabled);
  const result: PreviewResult = { leads: [], ran: [], errors: [], linkedin: "skipped" };

  // Cheap sources first: existing lists, job boards, news.
  for (const s of sources.filter((x) => !SOURCE_TYPES[x.source_type].needsLinkedIn)) {
    if (have() >= POOL || Date.now() > deadline) break;
    const r = await runSource(s, { maxNew: POOL - have() });
    result.ran.push(s.source_type);
    if (r.error) result.errors.push(`${s.source_type}: ${r.error}`);
  }

  const linkedinSources = sources.filter((x) => SOURCE_TYPES[x.source_type].needsLinkedIn && x.source_type !== "lookalike" && x.source_type !== "job_change");
  if (linkedinSources.length && have() < POOL) {
    const account = agent.linkedin_account_id ? db.prepare("SELECT is_authenticated FROM accounts WHERE id = ?").get(agent.linkedin_account_id) as { is_authenticated: number } | undefined : undefined;
    if (!account?.is_authenticated) result.linkedin = "no_account";
    else if (discoveryPausedUntil(agent.linkedin_account_id!)) result.linkedin = "paused";
    else {
      // Loaded lazily: the browser stack is only needed when LinkedIn sources run.
      const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
      const { VoyagerClient } = await import("@/lib/linkedin/voyager");
      const ctx = await getSessionContext(agent.linkedin_account_id!);
      const client = new VoyagerClient(ctx, agent.linkedin_account_id!);
      result.linkedin = "ok";
      try {
        for (const s of linkedinSources) {
          if (have() >= POOL || Date.now() > deadline) break;
          try {
            const r = await runSource(s, { voyager: client, browser: ctx, maxNew: POOL - have() });
            result.ran.push(s.source_type);
            if (r.error) result.errors.push(`${s.source_type}: ${r.error}`);
          } catch (err) {
            result.errors.push(`${s.source_type}: ${err instanceof Error ? err.message : String(err)}`);
            break; // budget or LinkedIn pushback: stop, keep what we have
          }
        }
      } finally {
        await client.close();
        await saveSessionState(agent.linkedin_account_id!).catch(() => {});
      }
    }
  }

  const icp = agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id);
  await scoreNewLeads(db, agent, icp?.data ?? null, icp?.id ?? null, POOL);
  result.leads = previewLeads(db, agent.id);
  return result;
}

/** Reject a preview lead: skip it (the reason helps tune scoring) and return the refreshed top five. */
export function rejectPreviewLead(db: Database.Database, agent: Agent, targetId: string, reason: string | null): PreviewLead[] {
  db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = ?, agent_status_at = datetime('now') WHERE id = ? AND agent_id = ?")
    .run(reason?.slice(0, 300) || "Rejected in preview", targetId, agent.id);
  return previewLeads(db, agent.id);
}
