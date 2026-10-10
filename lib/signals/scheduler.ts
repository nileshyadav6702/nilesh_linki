import type Database from "better-sqlite3";
import { createHash, randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { sourceNeedsLinkedIn, type AgentSource } from "@/lib/agents/store";
import { configWithItems, itemKeys } from "@/lib/agents/source-items";
import { DISCOVERY_DAILY_LIMITS, discoveryPausedUntil, usedToday } from "@/lib/linkedin/budget";
import { isSourceType } from "@/lib/signals/types";
import { tregEnabled } from "@/lib/treg/client";
import * as R from "@/lib/signals/schedule-rules";

/**
 * Signal scheduler. Every tracked item (a competitor page, a topic, a job board…) or, for
 * on/off signals, the source itself is a "unit" with its own clock in source_units. The
 * planner keeps units in step with the sources, decides which due unit may run (capacity,
 * LinkedIn account, hours, pauses, spacing, paced budget), runs it, and sets its next run
 * from the result: an adaptive cadence with jitter, backoff after errors, "needs attention"
 * for setup problems, and the next window when a budget is used up.
 */

type DB = Database.Database;
const HOUR = 3_600_000;

export interface SourceUnit {
  id: string; source_id: string; agent_id: string; workspace_id: string; source_type: string; item_key: string;
  state: "active" | "attention" | "waiting"; next_run_at: string; last_run_at: string | null; interval_hours: number;
  yield_avg: number | null; empty_runs: number; fail_count: number; last_error: string | null; note: string | null;
  last_result_json: string | null; config_hash: string | null; icp_ref: string | null; cost_avg_micro?: number | null;
}
interface DueUnit extends SourceUnit { linkedin_account_id: string | null; daily_lead_cap: number; daily_data_budget_usd?: number | null }

/** Sources that read the agent's ICP: a new ICP restarts their paging. */
const ICP_TYPES = new Set(["top_active", "new_decision_maker", "lookalike", "tech_stack"]);
/** Gap between new units' first runs, and between units re-spread after downtime. */
const NEW_GAP_MINUTES = 3;
const CATCH_UP_GAP_MINUTES = 5;
const OVERDUE_MINUTES = 15;

const iso = (ms: number) => new Date(ms).toISOString();
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const nextUtcMidnight = (now: number) => { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

/** The units a source should have: one per item for page/topic/board sources, else one ("*"). */
export function unitKeys(source: Pick<AgentSource, "source_type" | "config_json" | "agent_id">): string[] {
  if (!R.PER_ITEM_TYPES.has(source.source_type)) return ["*"];
  const keys = itemKeys(source);
  return keys.length ? keys : ["*"];
}

function icpRef(db: DB, agent: { icp_id: string | null; workspace_id: string }): string | null {
  if (agent.icp_id) return agent.icp_id;
  return (db.prepare("SELECT id FROM icps WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(agent.workspace_id) as { id: string } | undefined)?.id ?? null;
}

/**
 * Bring source_units in line with the sources: add units for new items (first runs staggered,
 * strongest intent first), drop units of removed items, wake units needing attention when their
 * setup changed, and restart ICP-based units when the agent's ICP changed. Returns units added.
 */
export function syncUnits(db: DB = getDb(), now = Date.now()): number {
  const sources = db.prepare(`SELECT s.*, a.icp_id, a.workspace_id ws FROM agent_sources s JOIN agents a ON a.id = s.agent_id`)
    .all() as Array<AgentSource & { icp_id: string | null; ws: string }>;
  const units = db.prepare("SELECT * FROM source_units").all() as SourceUnit[];
  const bySource = new Map<string, SourceUnit[]>();
  for (const u of units) bySource.set(u.source_id, [...(bySource.get(u.source_id) ?? []), u]);
  const icpCache = new Map<string, string | null>();

  const fresh: Array<{ agentId: string; sourceId: string; type: string; apply: (startMs: number) => void }> = [];
  const del = db.prepare("DELETE FROM source_units WHERE id = ?");
  const insert = db.prepare(`INSERT INTO source_units (id, source_id, agent_id, workspace_id, source_type, item_key, next_run_at, interval_hours, config_hash, icp_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const wake = db.prepare("UPDATE source_units SET state = 'active', next_run_at = ?, last_error = NULL, note = NULL, fail_count = 0, config_hash = ? WHERE id = ?");
  const setHash = db.prepare("UPDATE source_units SET config_hash = ? WHERE id = ?");
  const setIcp = db.prepare("UPDATE source_units SET icp_ref = ?, next_run_at = ? WHERE id = ?");

  let added = 0;
  db.transaction(() => {
    for (const s of sources) {
      if (!isSourceType(s.source_type)) continue;
      const keys = unitKeys(s);
      const have = bySource.get(s.id) ?? [];
      const cfg = hash(s.config_json || "{}");
      for (const u of have) if (!keys.includes(u.item_key)) del.run(u.id);
      let ref: string | null = null;
      if (ICP_TYPES.has(s.source_type)) {
        if (!icpCache.has(s.agent_id)) icpCache.set(s.agent_id, icpRef(db, { icp_id: s.icp_id, workspace_id: s.ws }));
        ref = icpCache.get(s.agent_id) ?? null;
      }
      let icpChanged = false;
      for (const u of have.filter((x) => keys.includes(x.item_key))) {
        if (u.config_hash !== cfg) {
          if (u.state === "attention") fresh.push({ agentId: s.agent_id, sourceId: s.id, type: s.source_type, apply: (t) => wake.run(iso(t), cfg, u.id) });
          else setHash.run(cfg, u.id);
        }
        if (ICP_TYPES.has(s.source_type) && u.icp_ref && ref && u.icp_ref !== ref) {
          icpChanged = true;
          fresh.push({ agentId: s.agent_id, sourceId: s.id, type: s.source_type, apply: (t) => setIcp.run(ref, iso(t), u.id) });
        } else if (ICP_TYPES.has(s.source_type) && !u.icp_ref && ref) setIcp.run(ref, u.next_run_at, u.id);
      }
      if (icpChanged) {
        // Paging tokens belong to the old ICP's search.
        let cursor: Record<string, unknown> = {};
        try { cursor = JSON.parse(s.cursor_json || "{}"); } catch { /* corrupt → reset */ }
        for (const k of Object.keys(cursor)) if (/token$/.test(k)) delete cursor[k];
        db.prepare("UPDATE agent_sources SET cursor_json = ? WHERE id = ?").run(JSON.stringify(cursor), s.id);
      }
      for (const key of keys.filter((k) => !have.some((u) => u.item_key === k))) {
        added++;
        fresh.push({ agentId: s.agent_id, sourceId: s.id, type: s.source_type, apply: (t) => insert.run(randomUUID(), s.id, s.agent_id, s.workspace_id, s.source_type, key, iso(t), R.baseCadence(s.source_type), cfg, ref) });
      }
    }
    // Per agent: strongest intent first, then one every few minutes.
    const byAgent = new Map<string, typeof fresh>();
    for (const f of fresh) byAgent.set(f.agentId, [...(byAgent.get(f.agentId) ?? []), f]);
    for (const list of byAgent.values()) {
      const starts = R.staggerStarts(list.map((f) => f.type), now, NEW_GAP_MINUTES);
      list.forEach((f, i) => f.apply(starts[i]));
    }
    for (const id of new Set(fresh.map((f) => f.sourceId))) syncSourceNext(db, id);
  })();
  return added;
}

/**
 * After downtime, a pause or a resumed agent, several units of one agent can be overdue at
 * once: spread them out again instead of firing together.
 */
export function respreadOverdue(db: DB = getDb(), now = Date.now()): number {
  const rows = db.prepare(`SELECT u.id, u.agent_id, u.source_id, u.source_type FROM source_units u JOIN agent_sources s ON s.id = u.source_id JOIN agents a ON a.id = u.agent_id
    WHERE s.enabled = 1 AND a.status = 'active' AND u.next_run_at < ? ORDER BY u.next_run_at`).all(iso(now - OVERDUE_MINUTES * 60_000)) as Array<{ id: string; agent_id: string; source_id: string; source_type: string }>;
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const set = db.prepare("UPDATE source_units SET next_run_at = ? WHERE id = ?");
  let moved = 0;
  for (const list of byAgent.values()) {
    if (list.length < 3) continue;
    const starts = R.staggerStarts(list.map((r) => r.source_type), now, CATCH_UP_GAP_MINUTES);
    list.forEach((r, i) => { set.run(iso(starts[i]), r.id); moved++; });
    for (const id of new Set(list.map((r) => r.source_id))) syncSourceNext(db, id);
  }
  return moved;
}

/** Due units of one kind, best first. */
export function dueUnits(db: DB, kind: "linkedin" | "http", now = Date.now(), accountId?: string): DueUnit[] {
  const rows = db.prepare(`SELECT u.*, a.linkedin_account_id, a.daily_lead_cap, a.daily_data_budget_usd FROM source_units u
      JOIN agent_sources s ON s.id = u.source_id JOIN agents a ON a.id = u.agent_id
     WHERE s.enabled = 1 AND a.status = 'active' AND u.next_run_at <= ?`).all(iso(now)) as DueUnit[];
  return rows
    .filter((u) => isSourceType(u.source_type) && sourceNeedsLinkedIn(u.source_type) === (kind === "linkedin"))
    .filter((u) => accountId === undefined || u.linkedin_account_id === accountId)
    .sort((a, b) => R.priority(b.source_type, b.yield_avg, (now - Date.parse(b.next_run_at)) / HOUR, b.interval_hours)
      - R.priority(a.source_type, a.yield_avg, (now - Date.parse(a.next_run_at)) / HOUR, a.interval_hours));
}

export interface AccountRow { id: string; is_authenticated: number; active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null }

export function accountWindow(a: AccountRow): R.ActiveWindow {
  const days = (a.working_days || "1,2,3,4,5").split(",").map(Number).filter((d) => d >= 0 && d <= 7).map((d) => (d === 0 ? 7 : d));
  return { start: a.active_hours_start ?? 9, end: a.active_hours_end ?? 18, days, timezone: a.timezone || "UTC" };
}

type Gate = { ok: true } | { ok: false; until: number; state: SourceUnit["state"]; note: string | null };

/** Data-provider spend attributed to the agent today (signals and enrichment), micro-USD. */
export function agentSpentTodayMicro(db: DB, agentId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(cost_micro), 0) s FROM treg_calls WHERE agent_id = ? AND created_at >= date('now')").get(agentId) as { s: number }).s;
}

function newLeadsToday(db: DB, agentId: string): number {
  return (db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND created_at >= date('now')").get(agentId) as { n: number }).n;
}
function reviewBacklog(db: DB, agentId: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM targets t WHERE t.agent_id = ? AND (t.agent_status = 'drafted'
    OR EXISTS (SELECT 1 FROM approval_queue aq WHERE aq.target_id = t.id AND aq.status = 'pending'))`).get(agentId) as { n: number }).n;
}

/** Whether a due unit may run now; if not, until when it waits and what the user sees. */
export function gate(db: DB, u: DueUnit, now = Date.now(), rand = Math.random): Gate {
  if (R.FILLER_TYPES.has(u.source_type)) {
    const full = newLeadsToday(db, u.agent_id) >= Math.max(1, u.daily_lead_cap) || reviewBacklog(db, u.agent_id) >= R.REVIEW_BACKLOG;
    if (full) return { ok: false, until: nextUtcMidnight(now) + rand() * 2 * HOUR, state: "waiting", note: "Paused for today: the agent already has enough leads to work on" };
  }
  if (!isSourceType(u.source_type) || !sourceNeedsLinkedIn(u.source_type)) {
    // Data-provider units share the agent's daily data budget; filler signals leave room for stronger ones.
    const budget = R.agentBudgetUsd(u.daily_data_budget_usd) * 1_000_000;
    const spent = agentSpentTodayMicro(db, u.agent_id);
    const limit = R.FILLER_TYPES.has(u.source_type) ? budget * R.FILLER_BUDGET_SHARE : budget;
    if (spent >= limit) {
      return { ok: false, until: nextUtcMidnight(now) + rand() * HOUR, state: "waiting", note: `Today's data budget ($${(budget / 1e6).toFixed(2)}) is used; resumes tomorrow` };
    }
    return { ok: true };
  }
  if (!u.linkedin_account_id) return { ok: false, until: now + R.ATTENTION_RECHECK_HOURS * HOUR, state: "attention", note: "No LinkedIn account selected on this agent" };
  const acc = db.prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(u.linkedin_account_id) as AccountRow | undefined;
  if (!acc?.is_authenticated) return { ok: false, until: now + HOUR, state: "waiting", note: "Waiting for the LinkedIn account to be reconnected" };
  const paused = discoveryPausedUntil(acc.id);
  if (paused) return { ok: false, until: Date.parse(paused.until) + rand() * 30 * 60_000, state: "waiting", note: "LinkedIn asked to slow down; resumes after the pause" };
  const w = accountWindow(acc);
  if (!R.inWindow(w, new Date(now))) return { ok: false, until: R.nextWindowStart(w, new Date(now)).getTime() + rand() * 45 * 60_000, state: "waiting", note: "Waiting for the LinkedIn account's working hours" };
  const last = (db.prepare(`SELECT MAX(u.last_run_at) t FROM source_units u JOIN agents a ON a.id = u.agent_id
    WHERE a.linkedin_account_id = ? AND u.source_type IN (${linkedInTypes().map(() => "?").join(",")})`).get(acc.id, ...linkedInTypes()) as { t: string | null }).t;
  const gap = R.accountSpacingMinutes(rand()) * 60_000;
  if (last && now - Date.parse(last) < gap) return { ok: false, until: Date.parse(last) + gap, state: "active", note: null };
  if (usedToday(acc.id, "voyager_read") >= R.pacedAllowance(w, DISCOVERY_DAILY_LIMITS.voyager_read, new Date(now))) {
    return { ok: false, until: now + 30 * 60_000, state: "active", note: "Pacing today's LinkedIn reads across working hours" };
  }
  return { ok: true };
}

function linkedInTypes(): string[] {
  return Object.keys(R.BASE_CADENCE_HOURS).filter((t) => isSourceType(t) && sourceNeedsLinkedIn(t));
}

export function deferUnit(db: DB, unitId: string, g: Exclude<Gate, { ok: true }>): void {
  const sourceId = (db.prepare("SELECT source_id FROM source_units WHERE id = ?").get(unitId) as { source_id: string } | undefined)?.source_id;
  // Account spacing (no note) keeps whatever the unit showed; other waits replace it.
  if (g.note === null) db.prepare("UPDATE source_units SET next_run_at = ? WHERE id = ?").run(iso(g.until), unitId);
  else db.prepare("UPDATE source_units SET next_run_at = ?, state = ?, note = ?, last_error = CASE WHEN ? = 'attention' THEN ? ELSE last_error END WHERE id = ?")
    .run(iso(g.until), g.state, g.note, g.state, g.note, unitId);
  if (sourceId && g.state === "attention") db.prepare("UPDATE agent_sources SET last_error = ? WHERE id = ?").run(g.note, sourceId);
  if (sourceId) syncSourceNext(db, sourceId);
}

/** Keep agent_sources.next_run_at (shown in the UI and the dashboard) as the source's soonest unit. */
function syncSourceNext(db: DB, sourceId: string) {
  db.prepare("UPDATE agent_sources SET next_run_at = (SELECT MIN(replace(substr(next_run_at, 1, 19), 'T', ' ')) FROM source_units WHERE source_id = ?) WHERE id = ?").run(sourceId, sourceId);
}

export interface UnitResult { candidates: number; ingested: number; error: string | null; errorName?: string; costMicro?: number }

/** Set the unit's next run from what the run did. */
export function recordResult(db: DB, u: SourceUnit & { linkedin_account_id?: string | null }, r: UnitResult, now = Date.now(), rand = Math.random): void {
  const yieldAvg = r.ingested > 0 || !r.error ? R.nextYield(u.yield_avg, r.ingested) : u.yield_avg;
  const empty = r.error ? u.empty_runs : r.ingested > 0 ? 0 : u.empty_runs + 1;
  const costAvg = r.costMicro !== undefined ? R.nextCost(u.cost_avg_micro ?? null, r.costMicro) : u.cost_avg_micro ?? null;
  const interval = R.adaptiveInterval(u.source_type, yieldAvg, empty, costAvg);
  const result = JSON.stringify({ candidates: r.candidates, ingested: r.ingested, cost_micro: r.costMicro ?? null, at: iso(now) });
  let next = now + R.jittered(interval, rand()) * HOUR;
  let state: SourceUnit["state"] = "active";
  let fail = 0;
  let note: string | null = null;
  if (r.error) {
    const cls = R.classifyError(r.error, r.errorName);
    if (cls === "transient") { fail = u.fail_count + 1; next = now + R.backoffHours(fail, interval) * HOUR; }
    // A top-up fixes an empty balance without any setup change: look again every couple of hours.
    else if (cls === "config") { state = "attention"; note = r.error; next = now + (R.isBalanceError(r.error) ? R.BALANCE_RECHECK_HOURS : R.ATTENTION_RECHECK_HOURS) * HOUR; }
    else if (cls === "blocked") { state = "waiting"; note = "LinkedIn asked to slow down; resumes after the pause"; next = now + 24 * HOUR + rand() * HOUR; }
    else {
      state = "waiting";
      note = "Today's budget is used up; resumes tomorrow";
      const acc = u.linkedin_account_id ? db.prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(u.linkedin_account_id) as AccountRow | undefined : undefined;
      const tomorrow = nextUtcMidnight(now);
      next = (acc && isSourceType(u.source_type) && sourceNeedsLinkedIn(u.source_type) ? R.nextWindowStart(accountWindow(acc), new Date(tomorrow)).getTime() : tomorrow) + rand() * HOUR;
    }
  }
  db.prepare(`UPDATE source_units SET last_run_at = ?, next_run_at = ?, interval_hours = ?, yield_avg = ?, empty_runs = ?, fail_count = ?,
      state = ?, last_error = ?, note = ?, last_result_json = ?, cost_avg_micro = ? WHERE id = ?`)
    .run(iso(now), iso(next), interval, yieldAvg, empty, fail, state, r.error, note, result, costAvg, u.id);
  syncSourceNext(db, u.source_id);
}

/** Run one unit: the source with only this unit's item, then schedule its next run. */
export async function runUnit(u: DueUnit | SourceUnit, deps: Parameters<typeof import("@/lib/signals/engine").runSource>[1] = {}): Promise<UnitResult> {
  const db = getDb();
  const { runSource } = await import("@/lib/signals/engine");
  const source = db.prepare("SELECT * FROM agent_sources WHERE id = ?").get(u.source_id) as AgentSource | undefined;
  if (!source) return { candidates: 0, ingested: 0, error: null };
  const scoped = u.item_key === "*" ? source : { ...source, config_json: JSON.stringify(configWithItems(source, (k) => k === u.item_key)) };
  let r: UnitResult;
  try {
    // Items that keep finding nobody read less (fewer posts, engagers, search rows).
    const out = await runSource(scoped, { ...deps, itemKey: u.item_key, lean: u.empty_runs >= 2 });
    const cost = out.runId ? (db.prepare("SELECT COALESCE(SUM(cost_micro), 0) s FROM treg_calls WHERE run_id = ?").get(out.runId) as { s: number }).s : 0;
    r = { candidates: out.candidates, ingested: out.ingested, error: out.error, costMicro: cost };
  } catch (err) {
    // Budget / LinkedIn pushback end the account's pass: record, then let the caller react.
    recordResult(db, u, { candidates: 0, ingested: 0, error: err instanceof Error ? err.message : String(err), errorName: err instanceof Error ? err.name : "" });
    throw err;
  }
  recordResult(db, u, r);
  return r;
}

/** One planner pass over data-provider / web units (no LinkedIn session). */
export async function runDueHttpUnits(max = 4, now = Date.now()): Promise<number> {
  const db = getDb();
  syncUnits(db, now);
  respreadOverdue(db, now);
  let ran = 0;
  for (const u of dueUnits(db, "http", now)) {
    if (ran >= max) break;
    const g = gate(db, u, now);
    if (!g.ok) { deferUnit(db, u.id, g); continue; }
    const r = await runUnit(u).catch((err: unknown) => ({ candidates: 0, ingested: 0, error: err instanceof Error ? err.message : String(err) }));
    if (r.error) console.warn(`[signals] ${u.source_type}${u.item_key === "*" ? "" : ` (${u.item_key})`}: ${r.error}`);
    ran++;
  }
  return ran;
}

/** LinkedIn accounts that have a unit allowed to run now (they get an account worker unit). */
export function linkedInDueAccounts(now = Date.now()): string[] {
  const db = getDb();
  syncUnits(db, now);
  respreadOverdue(db, now);
  const out = new Set<string>();
  for (const u of dueUnits(db, "linkedin", now)) {
    if (u.linkedin_account_id && out.has(u.linkedin_account_id)) continue;
    const g = gate(db, u, now);
    if (!g.ok) deferUnit(db, u.id, g);
    else if (u.linkedin_account_id) out.add(u.linkedin_account_id);
  }
  return [...out];
}

/** The best unit an account may run now (gating the others on the way), or null. */
export function nextLinkedInUnit(accountId: string, now = Date.now()): DueUnit | null {
  const db = getDb();
  for (const u of dueUnits(db, "linkedin", now, accountId)) {
    const g = gate(db, u, now);
    if (g.ok) return u;
    deferUnit(db, u.id, g);
  }
  return null;
}

/** Launch now: the source's units (or one item) run on the next pass. */
export function launchNow(db: DB, sourceId: string, itemKey?: string | null): number {
  syncUnits(db);
  const r = itemKey
    ? db.prepare("UPDATE source_units SET next_run_at = ?, state = 'active', note = NULL WHERE source_id = ? AND item_key = ?").run(iso(Date.now()), sourceId, itemKey)
    : db.prepare("UPDATE source_units SET next_run_at = ?, state = 'active', note = NULL WHERE source_id = ?").run(iso(Date.now()), sourceId);
  syncSourceNext(db, sourceId);
  return r.changes;
}

/** Units of one agent's sources, for the Sources tab. */
export function unitsForAgent(db: DB, agentId: string): SourceUnit[] {
  syncUnits(db);
  return db.prepare("SELECT * FROM source_units WHERE agent_id = ?").all(agentId) as SourceUnit[];
}

export interface UnitView {
  item_key: string; state: SourceUnit["state"]; next_run_at: string; cadence_hours: number; note: string | null;
  /** Data-provider cost and new leads this calendar month (UTC). */
  cost_month_micro: number; leads_month: number;
}

/** Days of open-role history hiring surge has (it needs two weeks before it can compare). */
function surgeHistoryDays(cursorJson: string | null): number {
  try {
    const counts = (JSON.parse(cursorJson || "{}").counts ?? {}) as Record<string, Array<{ at: string }>>;
    const firsts = Object.values(counts).map((h) => h[0]?.at).filter((x): x is string => !!x).map(Date.parse);
    return firsts.length ? Math.floor((Date.now() - Math.min(...firsts)) / 86_400_000) : 0;
  } catch { return 0; }
}

/** What the Sources tab shows per unit: cadence, next run, and why it waits when it does. */
export function unitViews(db: DB, agentId: string): Map<string, UnitView[]> {
  const out = new Map<string, UnitView[]>();
  const cursors = new Map((db.prepare("SELECT id, cursor_json FROM agent_sources WHERE agent_id = ?").all(agentId) as Array<{ id: string; cursor_json: string | null }>).map((r) => [r.id, r.cursor_json]));
  const month = new Date().toISOString().slice(0, 7);
  const costs = new Map((db.prepare(`SELECT source_id || '|' || COALESCE(item_key, '*') k, SUM(cost_micro) c FROM treg_calls
    WHERE agent_id = ? AND source_id IS NOT NULL AND substr(created_at, 1, 7) = ? GROUP BY 1`).all(agentId, month) as Array<{ k: string; c: number }>).map((r) => [r.k, r.c]));
  const leads = new Map((db.prepare(`SELECT dr.agent_source_id || '|' || COALESCE(dr.item_key, '*') k, SUM(dr.ingested) n FROM detector_runs dr
    JOIN agent_sources s ON s.id = dr.agent_source_id WHERE s.agent_id = ? AND substr(dr.started_at, 1, 7) = ? GROUP BY 1`).all(agentId, month) as Array<{ k: string; n: number }>).map((r) => [r.k, r.n]));
  for (const u of unitsForAgent(db, agentId)) {
    let note = u.state === "attention" ? u.last_error ?? u.note : u.note;
    // Board-based surge needs two weeks of counts; with the people database it works from day one.
    if (!note && u.source_type === "hiring_surge" && u.state === "active" && !tregEnabled()) {
      const days = surgeHistoryDays(cursors.get(u.source_id) ?? null);
      if (days < 14) note = `Building history (day ${days + 1} of 14)`;
    }
    const key = `${u.source_id}|${u.item_key}`;
    out.set(u.source_id, [...(out.get(u.source_id) ?? []), {
      item_key: u.item_key, state: u.state, next_run_at: u.next_run_at, cadence_hours: u.interval_hours, note,
      cost_month_micro: costs.get(key) ?? 0, leads_month: leads.get(key) ?? 0,
    }]);
  }
  return out;
}

export interface DataCost { month_micro: number; today_micro: number; enrichment_month_micro: number; budget_usd: number }

/** The agent's data-provider spend: this month, today (against its daily budget), and the enrichment part. */
export function agentDataCost(db: DB, agentId: string): DataCost {
  const month = new Date().toISOString().slice(0, 7);
  const r = db.prepare(`SELECT COALESCE(SUM(cost_micro), 0) month, COALESCE(SUM(CASE WHEN source_type = 'enrichment' THEN cost_micro END), 0) enrich
    FROM treg_calls WHERE agent_id = ? AND substr(created_at, 1, 7) = ?`).get(agentId, month) as { month: number; enrich: number };
  const budget = (db.prepare("SELECT daily_data_budget_usd b FROM agents WHERE id = ?").get(agentId) as { b: number | null } | undefined)?.b ?? null;
  return { month_micro: r.month, today_micro: agentSpentTodayMicro(db, agentId), enrichment_month_micro: r.enrich, budget_usd: R.agentBudgetUsd(budget) };
}
