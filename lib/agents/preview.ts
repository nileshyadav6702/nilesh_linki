import type Database from "better-sqlite3";
import { sourceNeedsLinkedIn } from "@/lib/agents/store";
import { getDb } from "@/lib/db";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { listSources, type Agent, type AgentSource } from "@/lib/agents/store";
import { scoreNewLeads } from "@/lib/agents/fit";
import { runSource } from "@/lib/signals/engine";
import { discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";

/**
 * Wizard "Preview": run the agent's sources once, now, until a small pool of leads exists,
 * score them, and show the best few. Nothing is drafted or sent. Rejected leads are skipped
 * and the next best from the pool takes their place.
 */

const POOL = 15;
/** The sample card shows five people. Stop once that many are in hand. */
const SAMPLE = 5;

export interface PreviewLead {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; location: string | null;
  linkedin_url: string | null; profile_image_url: string | null; lead_score: number | null; fit_verdict: string | null; fit_reason: string | null;
  industry: string | null; employee_count: number | null; signal_title: string | null; signal_type: string | null;
}

export function previewLeads(db: Database.Database, agentId: string, limit = 5, statuses: string[] = ["new", "qualified"]): PreviewLead[] {
  const marks = statuses.map(() => "?").join(",");
  return db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.location, t.linkedin_url, t.profile_image_url,
      t.lead_score, t.fit_verdict, t.fit_reason, c.industry, c.employee_count,
      (SELECT s.title FROM signals s WHERE s.target_id = t.id ORDER BY s.occurred_at DESC LIMIT 1) signal_title,
      (SELECT s.type FROM signals s WHERE s.target_id = t.id ORDER BY s.occurred_at DESC LIMIT 1) signal_type
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id
    WHERE t.agent_id = ? AND t.agent_status IN (${marks})
    ORDER BY (t.agent_status = 'qualified') DESC, COALESCE(t.lead_score, t.intent_score) DESC LIMIT ?`).all(agentId, ...statuses, limit) as PreviewLead[];
}

export interface PreviewSummary {
  /** People found by this agent so far (any status). */
  found: number;
  /** Scored and rejected by the ICP. */
  not_a_fit: number;
  /** Dropped before scoring (competitor staff, excluded titles...). */
  filtered: number;
  /** A few fit reasons from rejected leads, so the user can see what to change. */
  reasons: string[];
}

export interface PreviewResult { leads: PreviewLead[]; ran: string[]; errors: string[]; linkedin: "ok" | "no_account" | "paused" | "busy" | "skipped"; summary: PreviewSummary }

export function previewSummary(db: Database.Database, agentId: string, filtered: number): PreviewSummary {
  const counts = db.prepare("SELECT COUNT(*) found, SUM(agent_status = 'disqualified') not_a_fit FROM targets WHERE agent_id = ?").get(agentId) as { found: number; not_a_fit: number | null };
  const reasons = (db.prepare("SELECT DISTINCT fit_reason FROM targets WHERE agent_id = ? AND agent_status = 'disqualified' AND fit_reason IS NOT NULL ORDER BY scored_at DESC LIMIT 3").all(agentId) as Array<{ fit_reason: string }>).map((r) => r.fit_reason);
  return { found: counts.found, not_a_fit: counts.not_a_fit ?? 0, filtered, reasons };
}

export async function runPreview(agent: Agent, budgetMs = 120_000): Promise<PreviewResult> {
  const db = getDb();
  const deadline = Date.now() + budgetMs;
  const have = () => (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND agent_status IN ('new','qualified')").get(agent.id) as { n: number }).n;
  const sources = listSources(agent.id, agent.workspace_id).filter((s) => s.enabled);
  const result: PreviewResult = { leads: [], ran: [], errors: [], linkedin: "skipped", summary: { found: 0, not_a_fit: 0, filtered: 0, reasons: [] } };
  let filtered = 0;

  // Cheap sources first: existing lists, job boards, news.
  for (const s of sources.filter((x) => !sourceNeedsLinkedIn(x.source_type))) {
    if (have() >= POOL || Date.now() > deadline) break;
    const r = await runSource(s, { maxNew: POOL - have() });
    filtered += r.filtered;
    result.ran.push(s.source_type);
    if (r.error) result.errors.push(`${s.source_type}: ${r.error}`);
  }

  // Competitor pages are read from the feed, so they still work after the daily search allowance is used up.
  const linkedinSources = sources
    .filter((x) => sourceNeedsLinkedIn(x.source_type) && x.source_type !== "lookalike" && x.source_type !== "job_change")
    .sort((a, b) => Number(b.source_type === "competitor_engagement") - Number(a.source_type === "competitor_engagement"));
  if (linkedinSources.length && have() < SAMPLE) {
    const account = agent.linkedin_account_id ? db.prepare("SELECT is_authenticated FROM accounts WHERE id = ?").get(agent.linkedin_account_id) as { is_authenticated: number } | undefined : undefined;
    const paused = agent.linkedin_account_id ? discoveryPausedUntil(agent.linkedin_account_id) : null;
    if (!account?.is_authenticated) result.linkedin = "no_account";
    else if (paused) {
      result.linkedin = "paused";
      result.errors.push(/HTTP 401|HTTP 403/.test(paused.reason)
        ? "LinkedIn needs you to connect the account again before it can find people."
        : `LinkedIn is limiting this account, so finding people is paused until ${new Date(paused.until).toUTCString()}. Preview the leads again after that.`);
    } else {
      // Loaded lazily: the browser stack is only needed when LinkedIn sources run.
      const { AccountBusyError, withAccountSession } = await import("@/lib/linkedin/account-session");
      // Never drive the session alongside the runner (outreach, imports, discovery) — in this
      // process or in the worker process: parallel traffic on one account is what gets it
      // rate-limited. In the split deployment the web context is closed before release.
      try {
        filtered += await withAccountSession(agent.linkedin_account_id!, () => previewLinkedInSources(agent, linkedinSources, result, have, deadline));
      } catch (err) {
        if (!(err instanceof AccountBusyError)) throw err;
        result.linkedin = "busy";
        result.errors.push("This LinkedIn account is busy with other work right now. Preview the leads again in a few minutes.");
      }
    }
  }

  const icp = agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id);
  // A quick sample: score thin leads from their title instead of parking them as needs_data.
  await scoreNewLeads(db, agent, icp?.data ?? null, icp?.id ?? null, SAMPLE, { requireProfileText: false });
  result.leads = previewLeads(db, agent.id);
  if (!result.leads.length) result.leads = previewLeads(db, agent.id, SAMPLE, ["new", "qualified", "disqualified"]);
  result.summary = previewSummary(db, agent.id, filtered);
  return result;
}

/** Run the LinkedIn sources through the account's session until the sample is full. Returns how many leads were filtered. */
async function previewLinkedInSources(agent: Agent, sources: AgentSource[], result: PreviewResult, have: () => number, deadline: number): Promise<number> {
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { VoyagerClient, VoyagerBlockedError } = await import("@/lib/linkedin/voyager");
  const ctx = await getSessionContext(agent.linkedin_account_id!);
  const client = new VoyagerClient(ctx, agent.linkedin_account_id!);
  result.linkedin = "ok";
  let filtered = 0;
  try {
    for (const s of sources) {
      if (have() >= SAMPLE || Date.now() > deadline) break;
      try {
        const r = await runSource(s, { voyager: client, browser: ctx, maxNew: SAMPLE - have() });
        filtered += r.filtered;
        result.ran.push(s.source_type);
        if (r.error) result.errors.push(`${s.source_type}: ${r.error}`);
      } catch (err) {
        if (err instanceof VoyagerBlockedError) {
          // Same 24h pause as the runner's discovery: a shorter one let the runner hit the
          // account again while LinkedIn was still limiting it.
          if (err.status === 429 || err.status === 999) pauseDiscovery(agent.linkedin_account_id!, err.message);
          result.errors.push(err.status === 401 || err.status === 403
            ? "LinkedIn needs you to connect the account again before it can find people."
            : "LinkedIn is limiting this account, so finding people is paused for 24 hours to let it recover.");
          break;
        }
        result.errors.push(`${s.source_type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await client.close();
    await saveSessionState(agent.linkedin_account_id!).catch(() => {});
  }
  return filtered;
}

/** Reject a preview lead: skip it (the reason helps tune scoring) and return the refreshed top five. */
export function rejectPreviewLead(db: Database.Database, agent: Agent, targetId: string, reason: string | null): PreviewLead[] {
  db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = ?, agent_status_at = datetime('now') WHERE id = ? AND agent_id = ?")
    .run(reason?.slice(0, 300) || "Rejected in preview", targetId, agent.id);
  return previewLeads(db, agent.id);
}
