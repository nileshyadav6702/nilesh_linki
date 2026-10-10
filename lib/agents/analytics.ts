import type Database from "better-sqlite3";
import { signalLabel } from "@/lib/signals/types";

export interface FunnelRow {
  signal_type: string; label: string;
  detected: number; qualified: number; contacted: number; accepted: number; replied: number; positive: number; meetings: number;
}

/**
 * Funnel per signal type for one agent (or the whole workspace when agentId is null).
 * A lead is attributed to its strongest signal type, so each lead counts once.
 */
export function signalFunnel(db: Database.Database, workspaceId: string, agentId: string | null): FunnelRow[] {
  const rows = db.prepare(`
    WITH lead_signal AS (
      SELECT s.target_id, s.type,
             ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY COALESCE(s.weight, s.score) DESC, s.occurred_at DESC) rn
        FROM signals s
       WHERE s.workspace_id = ? AND s.target_id IS NOT NULL AND (? IS NULL OR s.agent_id = ?)
    )
    SELECT ls.type signal_type,
           COUNT(*) detected,
           SUM(CASE WHEN t.agent_status IN ('qualified','drafted','approved','enrolled') THEN 1 ELSE 0 END) qualified,
           SUM(CASE WHEN t.connection_requested_at IS NOT NULL OR t.message_sent_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM email_jobs ej WHERE ej.target_id = t.id AND ej.status = 'sent') THEN 1 ELSE 0 END) contacted,
           SUM(CASE WHEN t.connected_at IS NOT NULL THEN 1 ELSE 0 END) accepted,
           SUM(CASE WHEN t.last_replied_at IS NOT NULL OR t.email_replied_at IS NOT NULL THEN 1 ELSE 0 END) replied,
           SUM(CASE WHEN t.reply_kind IN ('positive','interested','meeting') THEN 1 ELSE 0 END) positive,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM meetings m WHERE m.target_id = t.id) THEN 1 ELSE 0 END) meetings
      FROM lead_signal ls JOIN targets t ON t.id = ls.target_id
     WHERE ls.rn = 1
     GROUP BY ls.type ORDER BY detected DESC`).all(workspaceId, agentId, agentId) as Array<Omit<FunnelRow, "label">>;
  return rows.map((r) => ({ ...r, label: signalLabel(r.signal_type) }));
}

export function agentCounts(db: Database.Database, agentId: string) {
  const status = db.prepare("SELECT agent_status s, COUNT(*) n FROM targets WHERE agent_id = ? GROUP BY agent_status").all(agentId) as Array<{ s: string | null; n: number }>;
  const today = db.prepare(`SELECT
      (SELECT COUNT(*) FROM targets WHERE agent_id = ? AND created_at >= date('now')) discovered,
      (SELECT COUNT(*) FROM targets WHERE agent_id = ? AND agent_status IN ('qualified','drafted','approved','enrolled') AND scored_at >= date('now')) qualified,
      (SELECT COUNT(*) FROM targets WHERE agent_id = ? AND agent_status = 'enrolled' AND agent_status_at >= date('now')) enrolled,
      (SELECT COUNT(*) FROM approval_queue WHERE agent_id = ? AND status = 'pending') pending_approvals`).get(agentId, agentId, agentId, agentId) as Record<string, number>;
  const cost = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) usd FROM ai_usage WHERE workspace_id = (SELECT workspace_id FROM agents WHERE id = ?) AND created_at >= date('now', '-30 days')`).get(agentId) as { usd: number };
  return { by_status: Object.fromEntries(status.map((r) => [r.s ?? "unassigned", r.n])), today, ai_cost_30d_usd: Math.round(cost.usd * 100) / 100 };
}

export interface AgentPerformance { found: number; contacted: number; accepted: number; replied: number; interested: number }

/** Lifetime funnel for one agent. Interested is a positive reply. */
export function agentPerformance(db: Database.Database, agentId: string): AgentPerformance {
  const row = db.prepare(`SELECT
      COUNT(*) found,
      SUM(CASE WHEN t.connection_requested_at IS NOT NULL OR t.message_sent_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM email_jobs ej WHERE ej.target_id = t.id AND ej.status = 'sent') THEN 1 ELSE 0 END) contacted,
      SUM(CASE WHEN t.connected_at IS NOT NULL THEN 1 ELSE 0 END) accepted,
      SUM(CASE WHEN t.last_replied_at IS NOT NULL OR t.email_replied_at IS NOT NULL THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN t.reply_kind IN ('positive','interested','meeting') THEN 1 ELSE 0 END) interested
    FROM targets t WHERE t.agent_id = ?`).get(agentId) as AgentPerformance;
  return {
    found: row.found ?? 0, contacted: row.contacted ?? 0, accepted: row.accepted ?? 0,
    replied: row.replied ?? 0, interested: row.interested ?? 0,
  };
}

export function nextSourceRun(db: Database.Database, agentId: string): string | null {
  const row = db.prepare(`SELECT MIN(next_run_at) at FROM agent_sources WHERE agent_id = ? AND enabled = 1 AND next_run_at IS NOT NULL`).get(agentId) as { at: string | null };
  return row.at;
}

/** Leads with a step due inside the next day on this agent's campaign. */
export function dueToday(db: Database.Database, workflowId: string | null): number {
  if (!workflowId) return 0;
  return (db.prepare(`SELECT COUNT(DISTINCT rp.target_id) n
    FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id = rt.run_profile_id
    JOIN runs r ON r.id = rp.run_id
    WHERE r.workflow_id = ? AND r.status = 'running'
      AND rt.state IN ('pending','in_progress')
      AND (rt.next_step_at IS NULL OR datetime(rt.next_step_at) <= datetime('now','+1 day'))`).get(workflowId) as { n: number }).n;
}

export interface DayPoint { day: string; found: number; invitations: number; messages: number; emails: number }

export function agentSeries(db: Database.Database, agentId: string, days = 7): DayPoint[] {
  const since = `-${days - 1} days`;
  const bucket = (sql: string) => db.prepare(sql).all(agentId, since) as Array<{ d: string; n: number }>;
  const found = bucket(`SELECT date(created_at) d, COUNT(*) n FROM targets WHERE agent_id = ? AND created_at >= date('now', ?) GROUP BY 1`);
  const invitations = bucket(`SELECT date(connection_requested_at) d, COUNT(*) n FROM targets WHERE agent_id = ? AND connection_requested_at >= date('now', ?) GROUP BY 1`);
  const messages = bucket(`SELECT date(message_sent_at) d, COUNT(*) n FROM targets WHERE agent_id = ? AND message_sent_at >= date('now', ?) GROUP BY 1`);
  const emails = db.prepare(`SELECT date(ej.created_at) d, COUNT(*) n FROM email_jobs ej JOIN targets t ON t.id = ej.target_id
    WHERE t.agent_id = ? AND ej.status = 'sent' AND ej.created_at >= date('now', ?) GROUP BY 1`).all(agentId, since) as Array<{ d: string; n: number }>;
  const pick = (rows: Array<{ d: string; n: number }>, day: string) => rows.find((r) => r.d === day)?.n ?? 0;
  const points: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    points.push({ day, found: pick(found, day), invitations: pick(invitations, day), messages: pick(messages, day), emails: pick(emails, day) });
  }
  return points;
}

export interface ActivityItem { id: string; kind: "discovery" | "campaign" | "setup"; title: string; detail: string | null; at: string }

export function agentActivity(db: Database.Database, agentId: string, workflowId: string | null, limit = 40): ActivityItem[] {
  const items: ActivityItem[] = [];
  const runs = db.prepare(`SELECT dr.id, s.source_type, dr.ingested, dr.filtered, dr.error, COALESCE(dr.finished_at, dr.started_at) at
    FROM detector_runs dr JOIN agent_sources s ON s.id = dr.agent_source_id
    WHERE s.agent_id = ? ORDER BY dr.started_at DESC LIMIT 20`).all(agentId) as Array<{ id: string; source_type: string; ingested: number; filtered: number; error: string | null; at: string }>;
  for (const r of runs) items.push({ id: `run:${r.id}`, kind: "discovery", title: signalLabel(r.source_type), detail: r.error ?? `${r.ingested} new, ${r.filtered} filtered`, at: r.at });
  const leads = db.prepare(`SELECT id, full_name, company, lead_source, created_at FROM targets WHERE agent_id = ? ORDER BY created_at DESC LIMIT 15`).all(agentId) as Array<{ id: string; full_name: string | null; company: string | null; lead_source: string | null; created_at: string }>;
  for (const l of leads) items.push({ id: `lead:${l.id}`, kind: "discovery", title: l.full_name ?? "New lead", detail: [l.lead_source, l.company].filter(Boolean).join(" · ") || null, at: l.created_at });
  if (workflowId) {
    const logs = db.prepare(`SELECT l.id, l.message, l.created_at FROM logs l JOIN runs r ON r.id = l.run_id
      WHERE r.workflow_id = ? AND l.level IN ('info','warn') ORDER BY l.created_at DESC LIMIT 20`).all(workflowId) as Array<{ id: string; message: string; created_at: string }>;
    for (const l of logs) items.push({ id: `log:${l.id}`, kind: "campaign", title: l.message, detail: null, at: l.created_at });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items.slice(0, limit);
}

/**
 * contacts: leads that have completed this step and not yet the next action step on its track
 * (waits in between count here). For an invitation step, invited/accepted cover everyone who
 * got past it, with accepted = the connection was accepted.
 */
export interface StepOccupancy { id: string; track: string; step_type: string; step_order: number; delay_seconds: number; contacts: number; invited?: number; accepted?: number }

/** Per action step: the current_step window [from, to) of leads sitting after it; to = null for the last one. */
export function stepWindows(db: Database.Database, workflowId: string): Map<string, { track: string; from: number; to: number | null }> {
  const rows = db.prepare("SELECT id, track, step_type, step_order FROM workflow_steps WHERE workflow_id = ? AND COALESCE(enabled, 1) = 1 ORDER BY track, step_order")
    .all(workflowId) as Array<{ id: string; track: string; step_type: string; step_order: number }>;
  const out = new Map<string, { track: string; from: number; to: number | null }>();
  const actions = rows.filter((r) => r.step_type !== "delay");
  actions.forEach((a, i) => {
    const next = actions.slice(i + 1).find((n) => n.track === a.track);
    out.set(a.id, { track: a.track, from: a.step_order, to: next ? next.step_order : null });
  });
  return out;
}

const TRACKS_IN_RUN = `FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
  WHERE r.workflow_id = ? AND r.status IN ('running','paused') AND rt.track = ?`;

/** SQL condition + params selecting the leads that sit after one action step (see stepWindows). */
export function afterStepWhere(w: { track: string; from: number; to: number | null }): { sql: string; params: unknown[] } {
  return w.to === null
    ? { sql: "(rt.state = 'completed' OR (rt.state = 'in_progress' AND rt.current_step >= ?))", params: [w.from] }
    : { sql: "rt.state = 'in_progress' AND rt.current_step >= ? AND rt.current_step < ?", params: [w.from, w.to] };
}

/** An invitation sent from this step on this track (the step holds the lead until it is accepted). */
const INVITED_HERE = "EXISTS (SELECT 1 FROM linkedin_actions la WHERE la.track_id = rt.id AND la.step_id = ? AND la.type = 'connect' AND la.status IN ('sent','uncertain'))";

/**
 * The leads "at" a step, as its card counts them and its contacts list shows them: past it and
 * not yet at the next action step; for an invitation step also those invited and still waiting
 * for an answer.
 */
export function atStepWhere(stepId: string, stepType: string, w: { track: string; from: number; to: number | null }): { sql: string; params: unknown[] } {
  const after = afterStepWhere(w);
  if (stepType !== "connect") return after;
  return { sql: `(${after.sql} OR (rt.state = 'in_progress' AND rt.current_step < ? AND ${INVITED_HERE}))`, params: [...after.params, w.from, stepId] };
}

export function stepOccupancy(db: Database.Database, workflowId: string | null): StepOccupancy[] {
  if (!workflowId) return [];
  const steps = db.prepare("SELECT id, track, step_type, step_order, delay_seconds FROM workflow_steps WHERE workflow_id = ? ORDER BY track, step_order").all(workflowId) as StepOccupancy[];
  const windows = stepWindows(db, workflowId);
  return steps.map((s) => {
    const w = windows.get(s.id);
    if (!w) return { ...s, contacts: 0 };
    const where = afterStepWhere(w);
    if (s.step_type !== "connect") {
      const contacts = (db.prepare(`SELECT COUNT(DISTINCT rp.target_id) n ${TRACKS_IN_RUN} AND ${where.sql}`).get(workflowId, s.track, ...where.params) as { n: number }).n;
      return { ...s, contacts };
    }
    // An invitation step holds the lead until the invitation is accepted (or it gives up), so
    // "past the step" misses every pending invitation. Count the invitations actually sent from
    // this step (linkedin_actions), plus anyone already past it.
    const past = db.prepare(`SELECT COUNT(DISTINCT rp.target_id) invited, COUNT(DISTINCT CASE WHEN t.connected_at IS NOT NULL THEN rp.target_id END) accepted
      ${TRACKS_IN_RUN.replace("JOIN runs r", "JOIN targets t ON t.id = rp.target_id JOIN runs r")} AND (rt.state = 'completed' OR rt.current_step >= ? OR ${INVITED_HERE})`)
      .get(workflowId, s.track, s.step_order, s.id) as { invited: number; accepted: number };
    // At this step now: invited and waiting for an answer (still on it), or accepted and waiting for the next step.
    const at = atStepWhere(s.id, s.step_type, w);
    const contacts = (db.prepare(`SELECT COUNT(DISTINCT rp.target_id) n ${TRACKS_IN_RUN} AND ${at.sql}`).get(workflowId, s.track, ...at.params) as { n: number }).n;
    return { ...s, contacts, invited: past.invited, accepted: past.accepted };
  });
}
