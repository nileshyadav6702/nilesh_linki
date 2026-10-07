import type Database from "better-sqlite3";

export const DEFAULT_HALF_LIFE_DAYS = 14;

export interface ScoredSignal { weight: number; occurred_at: string }

/**
 * Intent (0-100): each signal's weight decays by half every `halfLifeDays`, summed and
 * capped. A fresh competitor comment (30) beats three month-old ones.
 */
export function intentScore(signals: ScoredSignal[], now = Date.now(), halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  let total = 0;
  for (const s of signals) {
    const t = Date.parse(s.occurred_at.includes("T") || s.occurred_at.endsWith("Z") ? s.occurred_at : `${s.occurred_at.replace(" ", "T")}Z`);
    const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
    total += Math.max(0, s.weight) * Math.pow(0.5, ageDays / halfLifeDays);
  }
  return Math.round(Math.min(100, total) * 10) / 10;
}

/** Lead score = fitWeight * fit + (1 - fitWeight) * intent. Unscored fit counts as 50 (neutral). */
export function leadScore(fit: number | null | undefined, intent: number, fitWeight = 0.6): number {
  const w = Math.min(1, Math.max(0, fitWeight));
  const f = fit ?? 50;
  return Math.round((w * f + (1 - w) * intent) * 10) / 10;
}

/** Recompute a contact's intent from its signal history and refresh its lead score. */
export function recomputeIntent(db: Database.Database, targetId: string, fitWeight?: number): number {
  const rows = db.prepare("SELECT COALESCE(weight, score, 0) AS weight, occurred_at FROM signals WHERE target_id = ?").all(targetId) as ScoredSignal[];
  const intent = intentScore(rows);
  const target = db.prepare(`SELECT t.fit_score, a.fit_weight FROM targets t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = ?`).get(targetId) as { fit_score: number | null; fit_weight: number | null } | undefined;
  const lead = leadScore(target?.fit_score, intent, fitWeight ?? target?.fit_weight ?? 0.6);
  db.prepare("UPDATE targets SET intent_score = ?, lead_score = ? WHERE id = ?").run(intent, lead, targetId);
  return intent;
}
