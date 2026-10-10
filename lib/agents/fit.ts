import { z } from "zod";
import { withCostTag } from "@/lib/treg/cost-context";
import type Database from "better-sqlite3";
import { aiJson, isAiConfigured, isAiBlockingError } from "@/lib/ai/client";
import { icpTitleTerms, type Icp, type MatchMode } from "@/lib/icp/schema";
import { excludesServiceProviders, exclusionTerms } from "@/lib/icp/targeting";
import { screenLead } from "@/lib/agents/fit-rules";
import { recomputeIntent } from "@/lib/signals/scoring";
import type { Agent } from "@/lib/agents/store";
import { clearFailure, inBackoff, recordFailure } from "@/lib/agents/backoff";
import { tregEnabled } from "@/lib/treg/client";
import { enrichForScoring } from "@/lib/treg/enrich";

const BATCH = 10;

export const fitBatchSchema = z.object({
  leads: z.array(z.object({
    index: z.number().int(),
    fit_score: z.number().min(0).max(100),
    verdict: z.enum(["strong", "possible", "poor"]),
    /** How strongly the signal evidence points to the problem the offer solves (0-100). */
    signal_strength: z.number().min(0).max(100).optional(),
    /** Can this person buy or push the purchase (0-100)? */
    contact_relevance: z.number().min(0).max(100).optional(),
    reason: z.string().max(400),
  })).max(BATCH * 2),
});

interface LeadRow {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null;
  location: string | null; summary: string | null; company_industry: string | null; company_size: string | null; company_description: string | null;
  company_specialties?: string | null; company_founded?: number | null; company_type?: string | null;
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
const LEAD_COLUMNS = `t.id, t.full_name, t.headline, t.title, t.company, t.location, t.summary,
        c.industry company_industry, COALESCE(c.employee_count, c.employee_range) company_size, c.description company_description,
        c.specialties company_specialties, c.founded_year company_founded, c.org_type company_type`;

/** Same rows re-read after enrichment filled them in. */
function reloadRows(db: Database.Database, rows: LeadRow[]): LeadRow[] {
  if (!rows.length) return rows;
  const fresh = db.prepare(`SELECT ${LEAD_COLUMNS} FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id IN (${rows.map(() => "?").join(",")})`).all(...rows.map((r) => r.id)) as LeadRow[];
  const byId = new Map(fresh.map((r) => [r.id, r]));
  return rows.map((r) => byId.get(r.id) ?? r);
}

/** The verdict always follows the score (the model sometimes says "poor" next to a 65). */
export const verdictFor = (fit: number): "strong" | "possible" | "poor" => (fit >= 70 ? "strong" : fit >= 40 ? "possible" : "poor");

function loadUnscored(db: Database.Database, agent: Agent, icpId: string | null, limit: number, anyNeedsData = false): LeadRow[] {
  const rows = db.prepare(`SELECT ${LEAD_COLUMNS}
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

function topSignals(db: Database.Database, targetId: string): Array<{ type: string; title: string; snippet: string | null; occurred_at: string | null }> {
  return db.prepare("SELECT type, title, snippet, occurred_at FROM signals WHERE target_id = ? ORDER BY COALESCE(weight, score) DESC, occurred_at DESC LIMIT 3").all(targetId) as Array<{ type: string; title: string; snippet: string | null; occurred_at: string | null }>;
}

/** Automatic skips (not the user's judgement), excluded from feedback examples. */
const AUTO_SKIP = ["Already a 1st-degree connection%", "Someone from this company%", "Competitor:%", "%is on your blocklist", "Removed from%"];

/**
 * The user's own calls on this agent's leads, so the model scores new leads the way the user
 * would: up to 6 accepted (approved / in outreach) and 6 rejected, newest first.
 */
export function feedbackExamples(db: Database.Database, agentId: string): { accepted: unknown[]; rejected: unknown[] } {
  const accepted = db.prepare(`SELECT title, headline, company FROM targets WHERE agent_id = ? AND agent_status IN ('approved','enrolled')
    ORDER BY agent_status_at DESC LIMIT 6`).all(agentId);
  const rejected = db.prepare(`SELECT title, headline, company, skip_reason AS reason FROM targets WHERE agent_id = ? AND agent_status = 'skipped'
    AND skip_reason IS NOT NULL AND ${AUTO_SKIP.map(() => "skip_reason NOT LIKE ?").join(" AND ")} ORDER BY agent_status_at DESC LIMIT 6`).all(agentId, ...AUTO_SKIP);
  return { accepted, rejected };
}

/** ICP fit a lead needs to qualify (high precision); broader mode accepts anything not "poor". */
export const QUALIFY_FIT = 55;

/**
 * Whether a scored lead is kept, judged on ICP fit alone (who they are). How warm the lead is
 * (signal, recency, relevance) only sets its priority and whether outreach starts on its own.
 * high_precision: not "poor" and fit >= QUALIFY_FIT. broader: anything not "poor", plus a
 * low-confidence "poor" with fit >= 40 (thin profile, plausible match).
 */
export function isQualified(verdict: string, confidence: "high" | "low", fitScore: number, mode: MatchMode = "high_precision"): boolean {
  if (mode === "broader") return verdict !== "poor" || (confidence === "low" && fitScore >= 40);
  return verdict !== "poor" && fitScore >= QUALIFY_FIT;
}

/** Applies a fit verdict and moves the lead to qualified / disqualified on the agent's threshold. */
export function applyFit(db: Database.Database, agent: Agent, targetId: string, icpId: string | null, fit: { fit_score: number; verdict: string; reason: string; signal_strength?: number; contact_relevance?: number }, confidence: "high" | "low", mode: MatchMode = "high_precision") {
  db.prepare(`UPDATE targets SET fit_score = ?, fit_verdict = ?, fit_reason = ?, fit_confidence = ?, signal_strength = ?, contact_relevance = ?,
      scored_at = datetime('now'), scored_icp_id = ? WHERE id = ?`)
    .run(fit.fit_score, fit.verdict, fit.reason, confidence, fit.signal_strength ?? null, fit.contact_relevance ?? null, icpId, targetId);
  recomputeIntent(db, targetId, agent.fit_weight);
  const qualified = isQualified(fit.verdict, confidence, fit.fit_score, mode);
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
  let loaded = loadUnscored(db, agent, icpId, limit);
  const requireText = opts.requireProfileText ?? true;
  let screenedOut = 0;
  const reject = (id: string, reason: string) => {
    applyFit(db, agent, id, icpId, { fit_score: 0, verdict: "poor", reason }, "high", mode);
    clearFailure("score", id);
    screenedOut++;
  };
  if (tregEnabled() && icp && loaded.length) {
    // Free rules first, on what the signal already told us (headline, title, company): a lead
    // they reject (agency, excluded company, competitor…) is never paid for. Keyword checks wait
    // for the profile's about text.
    loaded = loaded.filter((l) => { const pre = screenLead(l, icp, false); if (pre.ok) return true; reject(l.id, pre.reason); return false; });
    // Then read profile + company first, so fit is judged on facts, not "company unknown". The
    // funding lookup (the priciest call) only runs when the agent tracks the funding signal.
    const funding = !!db.prepare("SELECT 1 FROM agent_sources WHERE agent_id = ? AND source_type = 'funding' AND enabled = 1").get(agent.id);
    const enriched = loaded.length
      ? await withCostTag({ agentId: agent.id, sourceType: "enrichment" }, () => enrichForScoring(db, agent.workspace_id, loaded.map((l) => l.id), { funding }))
      : 0;
    if (enriched) loaded = reloadRows(db, loaded);
  }
  const screened = icp ? loaded.filter((l) => {
    const r = screenLead(l, icp, !requireText || hasProfileText(l));
    if (r.ok) return true;
    reject(l.id, r.reason);
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
    "signal_strength (0-100): how strongly the lead's signals (data.leads[].signals: what they engaged with or did, and when) point to the problem data.icp.offer solves. A comment on a post about that exact problem is high; a like on a generic or unrelated post is low; no signals is 0.",
    "contact_relevance (0-100): whether this person can buy or push the purchase: decision makers and budget owners in the personas' departments are high, individual contributors lower, other departments low.",
    "Judge fit on who the person is; do not lower fit_score because a signal is weak (that is what signal_strength is for).",
    "data.feedback holds leads the user accepted and rejected for this agent: score similar people the same way.",
    "If a lead has little profile information, score from what is there and say so in the reason; do not invent facts.",
    "People who WORK AT a competitor, are students, recruiters or job seekers are poor fits.",
    "Engaging with a competitor's or anyone else's post is a buying signal, never a reason for a poor fit: judge fit on who the person is and where they work.",
    "data.icp.exclusions apply to the lead's own company, headline and title only, never to the posts or companies they engaged with.",
    "When the company is unknown, judge from the title and headline and say so; a matching role at an unknown company is a possible fit (40-69), not poor.",
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
        company_description: l.company_description?.slice(0, 300) ?? null,
        company_specialties: l.company_specialties?.slice(0, 200) ?? null, company_founded: l.company_founded ?? null, company_type: l.company_type ?? null, signals: topSignals(db, l.id),
      })),
      feedback: feedbackExamples(db, agent.id),
    },
    outputShape: `{"leads":[{"index":0,"fit_score":75,"verdict":"strong","signal_strength":60,"contact_relevance":80,"reason":""}]}`,
    schema: fitBatchSchema,
  });
  const byIndex = new Map(result.leads.map((r) => [r.index, r]));
  let scored = 0;
  batch.forEach((l, index) => {
    const r = byIndex.get(index);
    const fit = r ? { ...r, verdict: verdictFor(r.fit_score) } : ruleFit(l, icp);
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
