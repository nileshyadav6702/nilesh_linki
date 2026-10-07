import type { SourceRunner } from "@/lib/signals/sources/types";

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

/** Watches company job boards; open roles matching the agent's keywords become hiring signals. */
export const hiringRunner: SourceRunner = async (ctx) => {
  const keywords = ctx.config.role_keywords.length ? ctx.config.role_keywords : (ctx.icp?.personas ?? []).flatMap((p) => p.departments).slice(0, 8);
  for (const board of ctx.config.boards) {
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
