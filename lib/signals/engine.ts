import { randomUUID } from "crypto";
import { withCostTag } from "@/lib/treg/cost-context";
import { sourceNeedsLinkedIn } from "@/lib/agents/store";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import { ingestSignal } from "@/lib/platform/signals";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { parseSourceConfig, type Agent, type AgentSource } from "@/lib/agents/store";
import { prefilterLead, upsertLead, type LeadCandidate } from "@/lib/signals/leads";
import { SOURCE_TYPES, type SourceType } from "@/lib/signals/types";
import { engagementRunner, keywordRunner } from "@/lib/signals/sources/engagement";
import { jobChangeRunner } from "@/lib/signals/sources/job-change";
import { hiringRunner, hiringSurgeRunner } from "@/lib/signals/sources/hiring";
import { newDecisionMakerRunner, topActiveRunner } from "@/lib/signals/sources/icp-people";
import { techStackRunner } from "@/lib/signals/sources/tech-stack";
import { companyFollowersRunner, profileVisitorsRunner } from "@/lib/signals/sources/linkedin-audience";
import { fundingRunner } from "@/lib/signals/sources/funding";
import { lookalikeRunner } from "@/lib/signals/sources/lookalike";
import { existingListRunner, linkedinImportRunner } from "@/lib/signals/sources/imports";
import type { EmitResult, EmittedSignal, SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import type { VoyagerLike } from "@/lib/linkedin/engagers";

const RUNNERS: Record<SourceType, SourceRunner> = {
  competitor_engagement: engagementRunner("competitor_engagement"),
  influencer_engagement: engagementRunner("influencer_engagement"),
  own_content_engagement: engagementRunner("own_content_engagement"),
  keyword_engagement: keywordRunner,
  job_change: jobChangeRunner,
  hiring: hiringRunner,
  funding: fundingRunner,
  lookalike: lookalikeRunner,
  existing_list: existingListRunner,
  linkedin_import: linkedinImportRunner,
  top_active: topActiveRunner,
  new_decision_maker: newDecisionMakerRunner,
  hiring_surge: hiringSurgeRunner,
  tech_stack: techStackRunner,
  profile_visitors: profileVisitorsRunner,
  company_followers: companyFollowersRunner,
};

/** New leads one agent may add per day, so a viral post can't flood the workspace. */
export function discoveryCap(agent: Pick<Agent, "daily_lead_cap">): number {
  return Math.max(100, agent.daily_lead_cap * 8);
}

function newLeadsToday(db: Database.Database, agentId: string): number {
  return (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND created_at >= date('now')").get(agentId) as { n: number }).n;
}

function signalExists(db: Database.Database, workspaceId: string, key: string): boolean {
  return !!db.prepare("SELECT 1 FROM signals WHERE workspace_id = ? AND dedupe_key = ?").get(workspaceId, key);
}

function addToList(db: Database.Database, listId: string | null, targetId: string) {
  if (listId) db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(listId, targetId);
}

function findOrCreateCompany(db: Database.Database, workspaceId: string, c: { name: string; domain?: string | null; website?: string | null }): string {
  const existing = db.prepare("SELECT id FROM companies WHERE workspace_id = ? AND (lower(name) = lower(?) OR (? IS NOT NULL AND domain = ?))").get(workspaceId, c.name, c.domain ?? null, c.domain ?? null) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare("INSERT INTO companies (id, workspace_id, name, domain, website) VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, c.name, c.domain ?? null, c.website ?? null);
  return id;
}

const domainOf = (website: string | null | undefined) => {
  if (!website) return null;
  try { return new URL(/^https?:\/\//.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

/** About text and firmographics a source already had: stored so scoring needs no extra lookups. */
function saveExtras(db: Database.Database, workspaceId: string, targetId: string, c: LeadCandidate) {
  if (c.summary) db.prepare("UPDATE targets SET summary = COALESCE(summary, ?) WHERE id = ?").run(c.summary.slice(0, 4000), targetId);
  const info = c.companyInfo;
  if (!info?.name) return;
  const domain = domainOf(info.website);
  const companyId = findOrCreateCompany(db, workspaceId, { name: info.name, domain, website: info.website ?? null });
  db.prepare(`UPDATE companies SET industry = COALESCE(industry, ?), employee_count = COALESCE(employee_count, ?), description = COALESCE(description, ?),
      linkedin_url = COALESCE(linkedin_url, ?), location = COALESCE(location, ?), website = COALESCE(website, ?), domain = COALESCE(domain, ?) WHERE id = ?`)
    .run(info.industry ?? null, info.employeeCount ?? null, info.description?.slice(0, 2000) ?? null, info.linkedinUrl ?? null, info.location ?? null, info.website ?? null, domain, companyId);
  db.prepare("UPDATE targets SET company_id = COALESCE(company_id, ?) WHERE id = ?").run(companyId, targetId);
}

const SOCIAL_SIGNALS = new Set<string>(["competitor_engagement", "influencer_engagement", "keyword_engagement", "own_content_engagement"]);

export interface RunStats { candidates: number; ingested: number; filtered: number; duplicates: number }

export function buildContext(db: Database.Database, agent: Agent, source: AgentSource, detectorRunId: string, stats: RunStats, deps: { voyager?: VoyagerLike; browser?: BrowserContext; maxNew?: number; lean?: boolean }): SourceRunContext {
  const icpRecord = agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id);
  const icp = icpRecord?.data ?? null;
  const cap = discoveryCap(agent);
  let cursor: Record<string, unknown> = {};
  try { cursor = JSON.parse(source.cursor_json || "{}"); } catch { /* reset a corrupt cursor */ }

  const ingest = (targetId: string | undefined, companyId: string | undefined, s: EmittedSignal, key: string) => {
    ingestSignal({
      workspaceId: agent.workspace_id, targetId, companyId, type: s.type, title: s.title, description: s.snippet ?? undefined,
      source: `agent:${source.source_type}`, occurredAt: s.occurredAt ?? undefined, metadata: s.metadata,
      agentId: agent.id, sourceUrl: s.sourceUrl ?? undefined, snippet: s.snippet ?? undefined, detectorRunId, dedupeKey: key,
    });
  };

  return {
    db, workspaceId: agent.workspace_id, agent, source, config: parseSourceConfig(source.config_json), icp, detectorRunId, cursor, voyager: deps.voyager, browser: deps.browser, lean: deps.lean,
    isFull: () => deps.maxNew !== undefined && stats.ingested >= deps.maxNew,
    emitLead(candidate, signal, opts): EmitResult {
      stats.candidates++;
      if (signalExists(db, agent.workspace_id, signal.dedupeKey)) { stats.duplicates++; return "duplicate"; }
      // Anyone can react to a post: social signals must also name a persona role (unless the ICP asks for broader matching).
      const personaGate = SOCIAL_SIGNALS.has(signal.type) && (icp?.match_mode ?? "high_precision") === "high_precision";
      const verdict = prefilterLead(candidate, { icp, personaGate, excludeEmployeesOf: opts?.excludeEmployeesOf });
      if (!verdict.ok) { stats.filtered++; return "filtered"; }
      if (newLeadsToday(db, agent.id) >= cap || (deps.maxNew !== undefined && stats.ingested >= deps.maxNew)) return "capped";
      const { targetId } = upsertLead(db, agent.workspace_id, agent.id, candidate, signal.type === "lookalike" ? "lookalike" : "signal");
      saveExtras(db, agent.workspace_id, targetId, candidate);
      addToList(db, agent.list_id, targetId);
      ingest(targetId, undefined, signal, signal.dedupeKey);
      stats.ingested++;
      return "ingested";
    },
    emitForTarget(targetId, signal): EmitResult {
      stats.candidates++;
      if (signalExists(db, agent.workspace_id, signal.dedupeKey)) { stats.duplicates++; return "duplicate"; }
      ingest(targetId, undefined, signal, signal.dedupeKey);
      stats.ingested++;
      return "ingested";
    },
    emitForCompany(company, signal): EmitResult {
      stats.candidates++;
      if (signalExists(db, agent.workspace_id, signal.dedupeKey)) { stats.duplicates++; return "duplicate"; }
      const companyId = findOrCreateCompany(db, agent.workspace_id, company);
      ingest(undefined, companyId, signal, signal.dedupeKey);
      const people = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND (company_id = ? OR lower(company) = lower(?)) LIMIT 50")
        .all(agent.workspace_id, companyId, company.name) as Array<{ id: string }>;
      for (const p of people) {
        db.prepare("UPDATE targets SET agent_id = COALESCE(agent_id, ?), agent_status = COALESCE(agent_status, 'new') WHERE id = ?").run(agent.id, p.id);
        addToList(db, agent.list_id, p.id);
        ingest(p.id, companyId, signal, `${signal.dedupeKey}:t:${p.id}`);
      }
      stats.ingested++;
      return "ingested";
    },
  };
}

/**
 * Run one source now and record a detector_runs row. With `itemKey` (the signal scheduler, which
 * passes the source scoped to one item) the scheduler sets the next run; otherwise the source is
 * rescheduled by its interval.
 */
export async function runSource(source: AgentSource, deps: { voyager?: VoyagerLike & { requests?: number }; browser?: BrowserContext; maxNew?: number; itemKey?: string; lean?: boolean } = {}): Promise<RunStats & { error: string | null; runId?: string }> {
  const db = getDb();
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(source.agent_id) as Agent | undefined;
  const stats: RunStats = { candidates: 0, ingested: 0, filtered: 0, duplicates: 0 };
  if (!agent) return { ...stats, error: "Agent not found" };
  const runId = randomUUID();
  const requestsBefore = deps.voyager?.requests ?? 0;
  db.prepare("INSERT INTO detector_runs (id, agent_source_id, workspace_id, item_key) VALUES (?, ?, ?, ?)").run(runId, source.id, source.workspace_id, deps.itemKey && deps.itemKey !== "*" ? deps.itemKey : null);
  const ctx = buildContext(db, agent, source, runId, stats, deps);
  let error: string | null = null;
  try {
    await withCostTag({ agentId: agent.id, sourceId: source.id, sourceType: source.source_type, itemKey: deps.itemKey && deps.itemKey !== "*" ? deps.itemKey : null, runId },
      () => RUNNERS[source.source_type](ctx));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // Budget/blocks are handled by the caller; they still end this run cleanly.
    if (err instanceof Error && /(VoyagerBlockedError|VoyagerBudgetExceeded)/.test(err.name)) {
      finish();
      throw err;
    }
  }
  finish();
  return { ...stats, error, runId };

  function finish() {
    const requests = (deps.voyager?.requests ?? 0) - requestsBefore;
    db.prepare(`UPDATE detector_runs SET finished_at = datetime('now'), candidates = ?, ingested = ?, filtered = ?, linkedin_requests = ?, error = ? WHERE id = ?`)
      .run(stats.candidates, stats.ingested, stats.filtered, requests, error, runId);
    if (deps.itemKey !== undefined) {
      db.prepare("UPDATE agent_sources SET last_run_at = datetime('now'), cursor_json = ?, last_error = ? WHERE id = ?").run(JSON.stringify(ctx.cursor), error, source.id);
    } else {
      db.prepare(`UPDATE agent_sources SET last_run_at = datetime('now'), next_run_at = datetime('now', ?), cursor_json = ?, last_error = ? WHERE id = ?`)
        .run(`+${Math.round(source.interval_hours * 60)} minutes`, JSON.stringify(ctx.cursor), error, source.id);
    }
  }
}

/** Due sources of one kind. `accountId` narrows to agents reading through that LinkedIn account. */
export function dueSources(kind: "linkedin" | "http", limit = 20, accountId?: string): AgentSource[] {
  const types = (Object.keys(SOURCE_TYPES) as SourceType[]).filter((t) => sourceNeedsLinkedIn(t) === (kind === "linkedin"));
  const placeholders = types.map(() => "?").join(",");
  const byAccount = accountId !== undefined ? "AND a.linkedin_account_id = ?" : "";
  return getDb().prepare(`SELECT s.* FROM agent_sources s JOIN agents a ON a.id = s.agent_id
    WHERE s.enabled = 1 AND a.status = 'active' AND s.source_type IN (${placeholders}) ${byAccount}
      AND (s.next_run_at IS NULL OR s.next_run_at <= datetime('now'))
    ORDER BY s.next_run_at LIMIT ?`).all(...types, ...(accountId !== undefined ? [accountId] : []), limit) as AgentSource[];
}

/** Non-LinkedIn sources (data provider, job boards, news, websites), paced by the signal scheduler. */
export async function runDueHttpSources(): Promise<number> {
  const { runDueHttpUnits } = await import("@/lib/signals/scheduler");
  return runDueHttpUnits();
}
