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
