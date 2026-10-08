import { z } from "zod";
import type Database from "better-sqlite3";
import { aiJson, isAiConfigured, isAiBlockingError } from "@/lib/ai/client";
import { icpTitleTerms, type Icp } from "@/lib/icp/schema";
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
function loadUnscored(db: Database.Database, agent: Agent, icpId: string | null, limit: number): LeadRow[] {
  const rows = db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.location, t.summary,
        c.industry company_industry, c.employee_count company_size, c.description company_description
      FROM targets t LEFT JOIN companies c ON c.id = t.company_id
     WHERE t.agent_id = ? AND (t.scored_icp_id IS NULL OR t.scored_icp_id IS NOT ?)
       AND (t.agent_status = 'new'
         OR (t.agent_status = 'needs_data' AND (TRIM(COALESCE(t.headline, '')) != '' OR TRIM(COALESCE(t.summary, '')) != '')))
     ORDER BY t.intent_score DESC, t.created_at LIMIT ?`).all(agent.id, icpId, limit * 3) as LeadRow[];
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

/** Applies a fit verdict and moves the lead to qualified / disqualified on the agent's threshold. */
export function applyFit(db: Database.Database, agent: Agent, targetId: string, icpId: string | null, fit: { fit_score: number; verdict: string; reason: string }, confidence: "high" | "low") {
  db.prepare(`UPDATE targets SET fit_score = ?, fit_verdict = ?, fit_reason = ?, fit_confidence = ?, scored_at = datetime('now'), scored_icp_id = ? WHERE id = ?`)
    .run(fit.fit_score, fit.verdict, fit.reason, confidence, icpId, targetId);
  recomputeIntent(db, targetId, agent.fit_weight);
  const { lead_score } = db.prepare("SELECT lead_score FROM targets WHERE id = ?").get(targetId) as { lead_score: number };
  const qualified = fit.verdict !== "poor" && lead_score >= agent.min_score;
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
  const loaded = loadUnscored(db, agent, icpId, limit);
  const requireText = opts.requireProfileText ?? true;
  const leads = requireText ? loaded.filter((l) => hasProfileText(l)) : loaded;
  if (requireText) for (const l of loaded) if (!hasProfileText(l)) markNeedsData(db, l.id);
  if (!leads.length) return 0;
  if (!icp || !isAiConfigured(agent.workspace_id)) {
    for (const l of leads) applyFit(db, agent, l.id, icpId, ruleFit(l, icp), "low");
    return leads.length;
  }
  let scored = 0;
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

async function scoreBatch(db: Database.Database, agent: Agent, icp: Icp, icpId: string | null, batch: LeadRow[]): Promise<number> {
  const result = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "fit_score",
    temperature: 0.1,
    instructions: [
      "Score how well each lead in data.leads fits the ideal customer profile in data.icp, from 0 (no fit) to 100 (perfect buyer).",
      "Judge role, seniority, department and company against the ICP personas, industries, sizes and geographies.",
      "verdict: strong (>= 70), possible (40-69), poor (< 40). reason: one short sentence naming the deciding facts.",
      "If a lead has little profile information, score from what is there and say so in the reason; do not invent facts.",
      "People who work at a competitor, are students, recruiters or job seekers are poor fits.",
    ],
    data: {
      icp: { offer: icp.offer, industries: icp.industries, company_sizes: icp.company_sizes, geographies: icp.geographies, personas: icp.personas, competitors: icp.competitors.map((c) => c.name), exclusions: icp.exclusions },
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
      applyFit(db, agent, l.id, icpId, fit, r && hasProfileText(l) ? "high" : "low");
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
