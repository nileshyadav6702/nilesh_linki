import type Database from "better-sqlite3";
import { signalWeight } from "@/lib/signals/types";

export const DEFAULT_HALF_LIFE_DAYS = 14;

export interface ScoredSignal { weight: number; occurred_at: string }

const ageDaysOf = (iso: string, now: number) => {
  const t = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
};

/**
 * Intent (0-100): each signal's weight decays by half every `halfLifeDays`, summed and
 * capped. A fresh competitor comment (30) beats three month-old ones.
 */
export function intentScore(signals: ScoredSignal[], now = Date.now(), halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  let total = 0;
  for (const s of signals) total += Math.max(0, s.weight) * Math.pow(0.5, ageDaysOf(s.occurred_at, now) / halfLifeDays);
  return Math.round(Math.min(100, total) * 10) / 10;
}

/** Legacy blend (kept for callers that still use it): fitWeight * fit + (1 - fitWeight) * intent. */
export function leadScore(fit: number | null | undefined, intent: number, fitWeight = 0.6): number {
  const w = Math.min(1, Math.max(0, fitWeight));
  const f = fit ?? 50;
  return Math.round((w * f + (1 - w) * intent) * 10) / 10;
}

/* ─── Priority score (the lead score shown as flames) ──────────────────────────────────────── */

/**
 * Lead priority, 0-100, from four explainable parts:
 *   ICP fit 40% · signal strength 30% · recency 20% · contact relevance 10%.
 * Fit decides whether a lead qualifies at all (lib/agents/fit.ts); this decides how warm it is
 * and whether it goes to outreach automatically (score >= the agent's min_score).
 */
export const PRIORITY_WEIGHTS = { fit: 0.4, signal: 0.3, recency: 0.2, relevance: 0.1 } as const;
export const WARM_SCORE = 60;
export const HOT_SCORE = 80;

/** 1 = relevant, 2 = warm (goes to outreach), 3 = hot. */
export function flamesFor(score: number): 1 | 2 | 3 {
  return score >= HOT_SCORE ? 3 : score >= WARM_SCORE ? 2 : 1;
}

export interface PriorityParts { fit: number; signal: number; recency: number; relevance: number }

export function priorityScore(p: PriorityParts): number {
  const c = (n: number) => Math.min(100, Math.max(0, n));
  return Math.round((c(p.fit) * PRIORITY_WEIGHTS.fit + c(p.signal) * PRIORITY_WEIGHTS.signal + c(p.recency) * PRIORITY_WEIGHTS.recency + c(p.relevance) * PRIORITY_WEIGHTS.relevance) * 10) / 10;
}

/** Freshness of the newest signal: 100 within 2 days, then halving every 14 days. No signal: 0. */
export function recencyScore(latestIso: string | null | undefined, now = Date.now()): number {
  if (!latestIso) return 0;
  const age = ageDaysOf(latestIso, now);
  return Math.round((age <= 2 ? 100 : 100 * Math.pow(0.5, (age - 2) / DEFAULT_HALF_LIFE_DAYS)) * 10) / 10;
}

/** Signals that record how we found someone, not something they did. */
export const NON_EVENT_SIGNALS: ReadonlySet<string> = new Set(["lookalike", "custom", "existing_list", "linkedin_import"]);

/** Signal strength from the signal types alone (before the model has judged the evidence). */
export function baseSignalStrength(types: string[]): number {
  if (!types.length) return 0;
  const strongest = Math.max(...types.map((t) => signalWeight(t)));
  // A second distinct signal type is real corroboration: +15 each, capped.
  const extra = (new Set(types).size - 1) * 15;
  return Math.min(100, Math.round(strongest * 2.5 + extra));
}

/**
 * Recompute intent and the priority lead score from the stored fit, the model's signal and
 * relevance judgements (when present) and the contact's signal history. Called when a lead is
 * scored and whenever a new signal arrives, so a fresh signal warms a lead up immediately.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callers still pass the old fit weight
export function recomputeIntent(db: Database.Database, targetId: string, _fitWeight?: number): number {
  const rows = db.prepare("SELECT type, COALESCE(weight, score, 0) AS weight, occurred_at FROM signals WHERE target_id = ? ORDER BY occurred_at DESC").all(targetId) as Array<ScoredSignal & { type: string }>;
  const intent = intentScore(rows);
  const t = db.prepare("SELECT fit_score, signal_strength, contact_relevance FROM targets WHERE id = ?").get(targetId) as
    { fit_score: number | null; signal_strength: number | null; contact_relevance: number | null } | undefined;
  const base = baseSignalStrength(rows.map((r) => r.type));
  // The model's read of the evidence counts half; the signal type itself the other half.
  const signal = t?.signal_strength != null ? Math.round((t.signal_strength + base) / 2) : base;
  // Recency is about something the person did: a lookalike match or a list import isn't an event.
  const latestEvent = rows.find((r) => !NON_EVENT_SIGNALS.has(r.type))?.occurred_at;
  const parts: PriorityParts = { fit: t?.fit_score ?? 50, signal, recency: recencyScore(latestEvent), relevance: t?.contact_relevance ?? 50 };
  const lead = priorityScore(parts);
  db.prepare("UPDATE targets SET intent_score = ?, lead_score = ?, score_breakdown = ? WHERE id = ?")
    .run(intent, lead, JSON.stringify({ ...parts, weights: PRIORITY_WEIGHTS, version: 2 }), targetId);
  return intent;
}
