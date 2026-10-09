import { randomUUID } from "crypto";
import { z } from "zod";
import { aiJson, isAiConfigured } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import { fetchSiteText } from "@/lib/icp/site";

/**
 * Deep research of a list: check each company against up to two plain-language criteria by
 * reading the company's own website, then mark every contact at that company match / no match /
 * unknown. Runs in the background (one company at a time per worker, 3 workers); the UI polls.
 */

export const MAX_CRITERIA = 2;

export class ResearchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "ResearchError"; }
}

interface CompanyGroup { key: string; name: string; website: string | null; targetIds: string[] }

/** Contacts of the list grouped by company, with the best website we know for each. */
export function listCompanies(listId: string, workspaceId: string): CompanyGroup[] {
  const rows = getDb().prepare(`SELECT t.id, COALESCE(c.name, t.company) company, COALESCE(c.website, CASE WHEN c.domain IS NOT NULL THEN 'https://' || c.domain END) website
      FROM list_targets lt JOIN targets t ON t.id = lt.target_id LEFT JOIN companies c ON c.id = t.company_id
     WHERE lt.list_id = ? AND t.workspace_id = ?`).all(listId, workspaceId) as Array<{ id: string; company: string | null; website: string | null }>;
  const groups = new Map<string, CompanyGroup>();
  for (const r of rows) {
    const name = (r.company ?? "").trim();
    const key = name ? name.toLowerCase() : `contact:${r.id}`;
    const g = groups.get(key) ?? { key, name: name || "Unknown company", website: null, targetIds: [] };
    g.website = g.website ?? r.website;
    g.targetIds.push(r.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Rejects criteria too vague to verify from a website ("good company", "is a fit"). */
export async function checkCriterion(workspaceId: string, criterion: string): Promise<{ ok: boolean; message: string | null }> {
  const text = criterion.trim();
  if (text.length < 6) return { ok: false, message: "Too short: say exactly what to look for." };
  const r = await aiJson({
    workspaceId, purpose: "icp_extract", temperature: 0,
    instructions: [
      "Decide whether data.criterion can be verified as true or false by reading a company's public website.",
      "It is too vague when it relies on taste or unstated context (\"good fit\", \"not a competitor\" without naming competitors, \"high quality\").",
      "If too vague, give one short sentence telling the user exactly what to add, with an example.",
    ],
    data: { criterion: text },
    outputShape: `{"ok":true,"message":null}`,
    schema: z.object({ ok: z.boolean(), message: z.string().max(240).nullable() }),
  });
  return { ok: r.ok, message: r.ok ? null : r.message ?? "Too vague to research reliably: say exactly what Goji should look for." };
}

/** Starts a run and returns its id; the work continues after the request returns. */
export function startResearch(workspaceId: string, listId: string, criteria: string[]): string {
  if (!isAiConfigured(workspaceId)) throw new ResearchError("Add an AI key in Settings to run deep research.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM list_research WHERE list_id = ? AND status = 'running'").get(listId)) throw new ResearchError("A deep research run is already in progress for this list.", 409);
  const companies = listCompanies(listId, workspaceId);
  if (!companies.length) throw new ResearchError("This list has no contacts to research.");
  const id = randomUUID();
  db.prepare("INSERT INTO list_research (id, workspace_id, list_id, criteria_json, total) VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, listId, JSON.stringify(criteria), companies.length);
  void runResearch(id, workspaceId, listId, criteria, companies).catch((err) => {
    db.prepare("UPDATE list_research SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?").run(err instanceof Error ? err.message : String(err), id);
  });
  return id;
}

const verdictSchema = z.object({ results: z.array(z.object({ verdict: z.enum(["yes", "no", "unknown"]), evidence: z.string().max(300) })).max(MAX_CRITERIA) });

async function researchCompany(workspaceId: string, criteria: string[], g: CompanyGroup): Promise<{ verdict: "match" | "no_match" | "unknown"; summary: string }> {
  if (!g.website) return { verdict: "unknown", summary: "No company website on file to research." };
  let pages: Array<{ url: string; text: string }>;
  try { pages = (await fetchSiteText(g.website)).pages; } catch { return { verdict: "unknown", summary: `Couldn't load ${g.website}.` }; }
  const r = await aiJson({
    workspaceId, purpose: "icp_extract", temperature: 0,
    instructions: [
      "For each entry in data.criteria, answer yes, no or unknown for this company using ONLY data.website text.",
      "Answer unknown when the website does not say. Never guess. Evidence: one short sentence citing what the site says.",
      "Return results in the same order as data.criteria.",
    ],
    data: { company: g.name, criteria, website: pages.map((p) => ({ url: p.url, text: p.text.slice(0, 4000) })) },
    outputShape: `{"results":[{"verdict":"yes","evidence":""}]}`,
    schema: verdictSchema,
  });
  const res = criteria.map((c, i) => ({ c, ...(r.results[i] ?? { verdict: "unknown" as const, evidence: "No answer." }) }));
  // Every criterion is a must-have: one "no" fails the company; otherwise any "unknown" leaves it unknown.
  const failed = res.find((x) => x.verdict === "no");
  if (failed) return { verdict: "no_match", summary: `${failed.c}: ${failed.evidence}` };
  if (res.some((x) => x.verdict === "unknown")) return { verdict: "unknown", summary: res.map((x) => `${x.c}: ${x.evidence}`).join(" · ") };
  return { verdict: "match", summary: res.map((x) => x.evidence).join(" · ") };
}

async function runResearch(runId: string, workspaceId: string, listId: string, criteria: string[], companies: CompanyGroup[]) {
  const db = getDb();
  const save = db.prepare(`INSERT INTO target_research (target_id, list_id, run_id, verdict, summary) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(target_id, list_id) DO UPDATE SET run_id = excluded.run_id, verdict = excluded.verdict, summary = excluded.summary, researched_at = datetime('now')`);
  const tick = db.prepare("UPDATE list_research SET done_count = done_count + 1 WHERE id = ?");
  const queue = [...companies];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      let out: { verdict: "match" | "no_match" | "unknown"; summary: string };
      try { out = await researchCompany(workspaceId, criteria, g); }
      catch (err) { out = { verdict: "unknown", summary: `Research failed: ${err instanceof Error ? err.message.slice(0, 120) : "error"}` }; }
      db.transaction(() => { for (const t of g!.targetIds) save.run(t, listId, runId, out.verdict, out.summary.slice(0, 600)); tick.run(runId); })();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  db.prepare("UPDATE list_research SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(runId);
}

export function researchState(listId: string, workspaceId: string) {
  const db = getDb();
  const run = db.prepare("SELECT id, criteria_json, status, total, done_count, error, started_at, finished_at FROM list_research WHERE list_id = ? AND workspace_id = ? ORDER BY started_at DESC LIMIT 1").get(listId, workspaceId) as
    { id: string; criteria_json: string; status: string; total: number; done_count: number; error: string | null; started_at: string; finished_at: string | null } | undefined;
  const results = Object.fromEntries((db.prepare("SELECT target_id, verdict, summary FROM target_research WHERE list_id = ?").all(listId) as Array<{ target_id: string; verdict: string; summary: string | null }>)
    .map((r) => [r.target_id, { verdict: r.verdict, summary: r.summary }]));
  return { run: run ? { ...run, criteria: JSON.parse(run.criteria_json) as string[] } : null, results };
}
