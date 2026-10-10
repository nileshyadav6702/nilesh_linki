import type { SourceRunner } from "@/lib/signals/sources/types";
import { discoverBoards } from "@/lib/signals/sources/careers";
import type { SourceRunContext } from "@/lib/signals/sources/types";
import { prefilterLead } from "@/lib/signals/leads";
import { tregEnabled } from "@/lib/treg/client";
import { headcountGrowthFilter, SURGE_GROWTH_PCT, tregPeopleSearch } from "@/lib/treg/people";

export interface JobPosting { title: string; url: string; location: string | null; postedAt: string | null }

type Ats = "greenhouse" | "lever" | "ashby";

/** Public, unauthenticated job-board APIs. */
export function boardUrl(ats: Ats, slug: string): string {
  const s = encodeURIComponent(slug);
  if (ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${s}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
}

export function parseBoard(ats: Ats, json: unknown): JobPosting[] {
  const out: JobPosting[] = [];
  if (ats === "greenhouse") {
    for (const j of ((json as { jobs?: Array<Record<string, unknown>> })?.jobs ?? [])) {
      out.push({ title: String(j.title ?? ""), url: String(j.absolute_url ?? ""), location: (j.location as { name?: string } | undefined)?.name ?? null, postedAt: typeof j.updated_at === "string" ? j.updated_at : null });
    }
  } else if (ats === "lever") {
    for (const j of (Array.isArray(json) ? json as Array<Record<string, unknown>> : [])) {
      out.push({ title: String(j.text ?? ""), url: String(j.hostedUrl ?? ""), location: (j.categories as { location?: string } | undefined)?.location ?? null, postedAt: typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : null });
    }
  } else {
    for (const j of ((json as { jobs?: Array<Record<string, unknown>> })?.jobs ?? [])) {
      out.push({ title: String(j.title ?? ""), url: String(j.jobUrl ?? j.applyUrl ?? ""), location: typeof j.location === "string" ? j.location : null, postedAt: typeof j.publishedAt === "string" ? j.publishedAt : null });
    }
  }
  return out.filter((j) => j.title && j.url);
}

/** e.g. "2026-W41" — one hiring signal per board per week. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function matchesRoles(title: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = title.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

/** Companies whose careers pages are read per run when no boards are configured (free reads). */
const DISCOVER_PER_RUN = 6;

/**
 * Watches company job boards; open roles matching the agent's keywords become hiring signals.
 * Without configured boards, the boards are found from the careers pages of the agent's lead companies.
 */
export const hiringRunner: SourceRunner = async (ctx) => {
  const keywords = ctx.config.role_keywords.length ? ctx.config.role_keywords : (ctx.icp?.personas ?? []).flatMap((p) => p.departments).slice(0, 8);
  const boards = ctx.config.boards.length ? ctx.config.boards
    : await discoverBoards(ctx.db, ctx.workspaceId, ctx.agent.id, ctx.cursor, ctx.lean ? 2 : DISCOVER_PER_RUN);
  for (const board of boards) {
    let json: unknown;
    try {
      const res = await fetch(boardUrl(board.ats, board.slug), { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      json = await res.json();
    } catch { continue; }
    const company = board.company || board.slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const matching = parseBoard(board.ats, json).filter((j) => matchesRoles(j.title, keywords));
    if (!matching.length) continue;
    const top = matching.slice(0, 3).map((j) => j.title).join(", ");
    ctx.emitForCompany({ name: company }, {
      type: "hiring",
      title: `${company} is hiring: ${top}${matching.length > 3 ? ` +${matching.length - 3} more` : ""}`,
      snippet: matching.slice(0, 5).map((j) => `${j.title}${j.location ? ` (${j.location})` : ""}`).join("; "),
      sourceUrl: matching[0].url,
      // One signal per company per week of openings, so a long-open role doesn't re-fire daily.
      dedupeKey: `hiring:${board.ats}:${board.slug}:${isoWeek(new Date())}`,
      metadata: { ats: board.ats, slug: board.slug, roles: matching.slice(0, 20).map((j) => ({ title: j.title, url: j.url })) },
    });
  }
};

/** A board is "surging" when open roles grow by half (and by at least 5) against a 2-6 week old count. */
export const SURGE_MIN_ROLES = 5;
export const SURGE_RATIO = 1.5;
const SURGE_BASE_MIN_DAYS = 14;
const SURGE_BASE_MAX_DAYS = 42;

export type CountHistory = Array<{ at: string; n: number }>;

/** The count to compare against: the newest sample at least 2 weeks old (and at most 6). */
export function surgeBaseline(history: CountHistory, now = Date.now()): number | null {
  const age = (s: { at: string }) => (now - Date.parse(s.at)) / 86_400_000;
  const old = history.filter((s) => age(s) >= SURGE_BASE_MIN_DAYS && age(s) <= SURGE_BASE_MAX_DAYS);
  return old.length ? old[old.length - 1].n : null;
}

export function isSurge(now: number, base: number | null): boolean {
  return base !== null && now >= base * SURGE_RATIO && now - base >= SURGE_MIN_ROLES;
}

/** People found per run at fast-growing companies (paid rows, ~$0.0004 each). */
const GROWTH_PEOPLE_PER_RUN = 15;

/** The ICP's roles at companies whose headcount grew 20%+ in six months (the search filters on growth). */
async function growthSurge(ctx: SourceRunContext): Promise<void> {
  const r = await tregPeopleSearch(ctx.workspaceId, ctx.icp!, ctx.lean ? 5 : GROWTH_PEOPLE_PER_RUN, (ctx.cursor.growth_token as string | undefined) ?? null, headcountGrowthFilter());
  ctx.cursor.growth_token = r.token;
  const month = new Date().toISOString().slice(0, 7);
  for (const p of r.leads) {
    if (ctx.isFull()) break;
    if (!p.profileUrl || !prefilterLead(p, { icp: ctx.icp }).ok) continue;
    ctx.emitLead(p, {
      type: "hiring_surge", title: `${p.company ?? "Their company"} is growing fast: headcount up ${SURGE_GROWTH_PCT}%+ in 6 months`,
      sourceUrl: p.profileUrl, dedupeKey: `hiring_surge:growth:${p.profileUrl}:${month}`, metadata: { company: p.company, min_growth_pct: SURGE_GROWTH_PCT, timespan: "6months" },
    });
  }
}

/**
 * Hiring surge, two ways: with the people database, the ICP's roles at companies whose headcount
 * grew 20%+ in six months (no history needed); and on the boards of Job openings, a company whose
 * open roles jump against the count from a few weeks before (the first weeks build that history).
 */
export const hiringSurgeRunner: SourceRunner = async (ctx) => {
  const growth = tregEnabled() && !!ctx.icp;
  if (growth) await growthSurge(ctx);
  // The boards Job openings watches: typed in, or found on the lead companies' careers pages.
  const row = ctx.db.prepare("SELECT config_json, cursor_json FROM agent_sources WHERE agent_id = ? AND source_type = 'hiring' ORDER BY created_at LIMIT 1").get(ctx.agent.id) as { config_json: string; cursor_json: string | null } | undefined;
  let boards: Array<{ ats: Ats; slug: string; company?: string }> = [];
  try { boards = (JSON.parse(row?.config_json || "{}").boards ?? []) as typeof boards; } catch { /* no boards */ }
  if (!boards.length) {
    try {
      const found = Object.values((JSON.parse(row?.cursor_json || "{}").discovered ?? {}) as Record<string, { board: { ats: Ats; slug: string } | null; company: string }>);
      boards = found.filter((d) => d.board).map((d) => ({ ...d.board!, company: d.company }));
    } catch { /* nothing found yet */ }
  }
  if (!boards.length) {
    if (growth) return;
    throw new Error("Hiring surge watches the job boards under Job openings: turn on Job openings (or add a board) first");
  }
  const all = (ctx.cursor.counts as Record<string, CountHistory> | undefined) ?? {};
  const nowIso = new Date().toISOString();
  for (const board of boards) {
    const key = `${board.ats}:${board.slug}`;
    let jobs: JobPosting[];
    try {
      const res = await fetch(boardUrl(board.ats, board.slug), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      jobs = parseBoard(board.ats, await res.json());
    } catch { continue; }
    const history = all[key] ?? [];
    const base = surgeBaseline(history);
    // One sample a day is enough; keep ~2 months.
    if (!history.length || history[history.length - 1].at.slice(0, 10) !== nowIso.slice(0, 10)) history.push({ at: nowIso, n: jobs.length });
    all[key] = history.filter((s) => Date.now() - Date.parse(s.at) <= 60 * 86_400_000);
    if (!isSurge(jobs.length, base)) continue;
    const company = board.company || board.slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    ctx.emitForCompany({ name: company }, {
      type: "hiring_surge", title: `Hiring surge at ${company}: ${jobs.length} open roles (up from ${base})`,
      snippet: jobs.slice(0, 5).map((j) => j.title).join("; "), sourceUrl: jobs[0]?.url ?? null,
      dedupeKey: `hiring_surge:${key}:${isoWeek(new Date())}`, metadata: { ats: board.ats, slug: board.slug, open_roles: jobs.length, baseline: base },
    });
  }
  ctx.cursor.counts = all;
};
