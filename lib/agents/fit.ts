import { z } from "zod";
import type Database from "better-sqlite3";
import { aiJson, isAiConfigured, isAiBlockingError } from "@/lib/ai/client";
import { icpTitleTerms, type Icp, type MatchMode } from "@/lib/icp/schema";
import { excludesServiceProviders, exclusionTerms } from "@/lib/icp/targeting";
import { screenLead } from "@/lib/agents/fit-rules";
import { recomputeIntent } from "@/lib/signals/scoring";
import type { Agent } from "@/lib/agents/store";
import { clearFailure, inBackoff, recordFailure } from "@/lib/agents/backoff";

const BATCH = 10;

export const fitBatchSchema = z.object({
  leads: z.array(z.object({
    index: z.number().int(),
    fit_score: z.number().min(0).max(100),
    verdict: z.enum(["strong", "possible", "poor"]),
    reason: z.string().max(400),
  })).max(BATCH * 2),
});

interface LeadRow {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null;
  location: string | null; summary: string | null; company_industry: string | null; company_size: string | null; company_description: string | null;
}

export function hasProfileText(l: Pick<LeadRow, "headline" | "summary" | "title">): boolean {
  return !!(l.headline?.trim() || l.summary?.trim());
}

/** Rule-based fit for when no model is configured: persona title overlap only. */
export function ruleFit(l: Pick<LeadRow, "headline" | "title">, icp: Icp | null): { fit_score: number; verdict: "strong" | "possible" | "poor"; reason: string } {
  const terms = icp ? icpTitleTerms(icp) : [];
  const text = `${l.title ?? ""} ${l.headline ?? ""}`.toLowerCase();
  if (!terms.length) return { fit_score: 50, verdict: "possible", reason: "No ICP personas defined — neutral score" };
  const hit = terms.find((t) => text.includes(t));
  return hit
    ? { fit_score: 72, verdict: "strong", reason: `Title matches persona "${hit}" (rule-based; configure AI for a full assessment)` }
    : { fit_score: 35, verdict: "poor", reason: "Title matches no ICP persona (rule-based)" };
}

/**
 * Leads waiting for a fit score: new ones, plus needs_data ones whose headline or about has
 * since been filled in (profile enrichment, job-change re-check). Leads in retry backoff wait.
 */
function loadUnscored(db: Database.Database, agent: Agent, icpId: string | null, limit: number, anyNeedsData = false): LeadRow[] {
  const rows = db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.location, t.summary,
        c.industry company_industry, c.employee_count company_size, c.description company_description
      FROM targets t LEFT JOIN companies c ON c.id = t.company_id
     WHERE t.agent_id = ? AND (t.scored_icp_id IS NULL OR t.scored_icp_id IS NOT ?)
       AND (t.agent_status = 'new'
         OR (t.agent_status = 'needs_data' AND (? OR TRIM(COALESCE(t.headline, '')) != '' OR TRIM(COALESCE(t.summary, '')) != '')))
     ORDER BY t.intent_score DESC, t.created_at LIMIT ?`).all(agent.id, icpId, anyNeedsData ? 1 : 0, limit * 3) as LeadRow[];
  return rows.filter((r) => !inBackoff("score", r.id)).slice(0, limit);
}

/** Without a headline or about the ICP cannot be judged: park the lead instead of disqualifying it. */
export function markNeedsData(db: Database.Database, targetId: string): void {
  db.prepare(`UPDATE targets SET agent_status = 'needs_data', agent_status_at = datetime('now'),
      fit_reason = 'Waiting for headline or about to score against the ICP' WHERE id = ? AND agent_status = 'new'`).run(targetId);
}

function topSignals(db: Database.Database, targetId: string): Array<{ type: string; title: string; snippet: string | null }> {
  return db.prepare("SELECT type, title, snippet FROM signals WHERE target_id = ? ORDER BY COALESCE(weight, score) DESC, occurred_at DESC LIMIT 3").all(targetId) as Array<{ type: string; title: string; snippet: string | null }>;
}

/**
 * Whether a scored lead is kept. high_precision: not "poor" and at or above the agent's min score.
 * broader (strictly more permissive): anything not "poor" passes regardless of score, and a
 * low-confidence "poor" still passes when it clears the min score. Only a confident "poor" drops.
 */
export function isQualified(verdict: string, confidence: "high" | "low", leadScore: number, minScore: number, mode: MatchMode = "high_precision"): boolean {
  if (mode === "broader") return verdict !== "poor" || (confidence === "low" && leadScore >= minScore);
  return verdict !== "poor" && leadScore >= minScore;
}

/** Applies a fit verdict and moves the lead to qualified / disqualified on the agent's threshold. */
export function applyFit(db: Database.Database, agent: Agent, targetId: string, icpId: string | null, fit: { fit_score: number; verdict: string; reason: string }, confidence: "high" | "low", mode: MatchMode = "high_precision") {
  db.prepare(`UPDATE targets SET fit_score = ?, fit_verdict = ?, fit_reason = ?, fit_confidence = ?, scored_at = datetime('now'), scored_icp_id = ? WHERE id = ?`)
    .run(fit.fit_score, fit.verdict, fit.reason, confidence, icpId, targetId);
  recomputeIntent(db, targetId, agent.fit_weight);
  const { lead_score } = db.prepare("SELECT lead_score FROM targets WHERE id = ?").get(targetId) as { lead_score: number };
  const qualified = isQualified(fit.verdict, confidence, lead_score, agent.min_score, mode);
  db.prepare("UPDATE targets SET agent_status = ?, agent_status_at = datetime('now') WHERE id = ?").run(qualified ? "qualified" : "disqualified", targetId);
  return qualified;
}

export interface ScoreOptions {
  /**
   * Park leads with no headline and no about as needs_data instead of scoring them (default).
   * The wizard preview passes false: it shows a quick sample and scores from the title.
   */
  requireProfileText?: boolean;
}

/**
 * Scores up to `limit` new leads for the agent. Returns how many were scored. A failed batch
 * is logged and its leads back off; the remaining batches still run. Only errors the user
 * must fix (AI key, credit, spend cap) abort the pass.
 */
export async function scoreNewLeads(db: Database.Database, agent: Agent, icp: Icp | null, icpId: string | null, limit = 20, opts: ScoreOptions = {}): Promise<number> {
  const mode: MatchMode = icp?.match_mode ?? "high_precision";
  if (mode === "skip") {
    // ICP filtering and scoring is off: every lead is kept as-is, no rules and no model call.
    const all = loadUnscored(db, agent, icpId, limit, true);
    for (const l of all) skipFit(db, l.id, icpId);
    return all.length;
  }
  const loaded = loadUnscored(db, agent, icpId, limit);
  const requireText = opts.requireProfileText ?? true;
  let screenedOut = 0;
  const screened = icp ? loaded.filter((l) => {
    const r = screenLead(l, icp, !requireText || hasProfileText(l));
    if (r.ok) return true;
    applyFit(db, agent, l.id, icpId, { fit_score: 0, verdict: "poor", reason: r.reason }, "high", mode);
    clearFailure("score", l.id);
    screenedOut++;
    return false;
  }) : loaded;
  const leads = requireText ? screened.filter((l) => hasProfileText(l)) : screened;
  if (requireText) for (const l of screened) if (!hasProfileText(l)) markNeedsData(db, l.id);
  if (!leads.length) return screenedOut;
  if (!icp || !isAiConfigured(agent.workspace_id)) {
    for (const l of leads) applyFit(db, agent, l.id, icpId, ruleFit(l, icp), "low", mode);
    return screenedOut + leads.length;
  }
  let scored = screenedOut;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    try {
      scored += await scoreBatch(db, agent, icp, icpId, batch);
    } catch (err) {
      if (isAiBlockingError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[agents] fit batch failed for agent ${agent.id}: ${message}`);
      for (const l of batch) recordFailure("score", l.id, message);
    }
  }
  return scored;
}

/** match_mode "skip": keep the lead without scoring it. */
function skipFit(db: Database.Database, targetId: string, icpId: string | null): void {
  db.prepare(`UPDATE targets SET fit_reason = 'ICP filtering skipped', fit_confidence = 'low', scored_at = datetime('now'), scored_icp_id = ?,
      agent_status = 'qualified', agent_status_at = datetime('now') WHERE id = ?`).run(icpId, targetId);
  clearFailure("score", targetId);
}

/** Scoring-prompt rules, including the ones that depend on the ICP's targeting switches. */
export function fitInstructions(icp: Icp): string[] {
  const out = [
    "Score how well each lead in data.leads fits the ideal customer profile in data.icp, from 0 (no fit) to 100 (perfect buyer).",
    "Judge role, seniority, department and company against the ICP personas, industries, company types, sizes and geographies.",
    "verdict: strong (>= 70), possible (40-69), poor (< 40). reason: one short sentence naming the deciding facts.",
    "If a lead has little profile information, score from what is there and say so in the reason; do not invent facts.",
    "People who work at a competitor, are students, recruiters or job seekers are poor fits.",
    "People whose company, headline or title matches anything in data.icp.exclusions are poor fits.",
  ];
  if (excludesServiceProviders(icp)) out.push("People at agencies, consultancies, freelancers and B2B service providers (data.icp.exclude_service_providers) are poor fits.");
  if (icp.ai_competitor_filtering) out.push("Also treat as a poor fit anyone working at a company that competes with data.icp.company_name (sells an offer similar to data.icp.offer), even if it is not listed in data.icp.competitors; say \"competitor\" in the reason.");
  if (icp.match_mode === "broader") out.push("Be lenient: when the fit is plausible but uncertain, prefer possible over poor.");
  return out;
}

async function scoreBatch(db: Database.Database, agent: Agent, icp: Icp, icpId: string | null, batch: LeadRow[]): Promise<number> {
  const result = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "fit_score",
    temperature: 0.1,
    instructions: fitInstructions(icp),
    data: {
      icp: {
        company_name: icp.company_name, offer: icp.offer, industries: icp.industries, company_types: icp.company_types, company_sizes: icp.company_sizes,
        geographies: icp.geographies, personas: icp.personas, competitors: icp.competitors.map((c) => c.name), exclusions: exclusionTerms(icp),
        exclude_service_providers: excludesServiceProviders(icp),
      },
      leads: batch.map((l, index) => ({
        index, name: l.full_name, headline: l.headline, title: l.title, company: l.company, location: l.location,
        about: l.summary?.slice(0, 500) ?? null, company_industry: l.company_industry, company_size: l.company_size,
        company_description: l.company_description?.slice(0, 300) ?? null, signals: topSignals(db, l.id),
      })),
    },
    outputShape: `{"leads":[{"index":0,"fit_score":75,"verdict":"strong","reason":""}]}`,
    schema: fitBatchSchema,
  });
  const byIndex = new Map(result.leads.map((r) => [r.index, r]));
  let scored = 0;
  batch.forEach((l, index) => {
    const r = byIndex.get(index);
    const fit = r ?? ruleFit(l, icp);
    try {
      applyFit(db, agent, l.id, icpId, fit, r && hasProfileText(l) ? "high" : "low", icp.match_mode);
      clearFailure("score", l.id);
      scored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[agents] applying fit failed for ${l.id}: ${message}`);
      recordFailure("score", l.id, message);
    }
  });
  return scored;
}
