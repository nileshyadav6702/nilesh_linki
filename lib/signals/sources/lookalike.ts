import { hasActiveImport, startImport } from "@/lib/import-jobs";
import { isFlagshipSearchUrl } from "@/lib/agents/lookalike-rules";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";
import { tregEnabled } from "@/lib/treg/client";
import { tregPeopleSearch } from "@/lib/treg/people";

/** Rows per treg people-search run (each row costs ~$0.0004). */
const TREG_PAGE = 50;

/** With treg: ICP people search on a leads database, paged with a stored token. */
async function tregLookalike(ctx: SourceRunContext) {
  if (!ctx.icp) throw new Error("Set up the agent's targeting first: lookalike search uses its job titles, industries and sizes");
  // Rows are paid: ask for about what the agent can still take today (twice that, as some get filtered).
  const today = (ctx.db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ? AND created_at >= date('now')").get(ctx.agent.id) as { n: number }).n;
  const room = Math.max(0, ctx.agent.daily_lead_cap - today);
  if (!room) return;
  const size = Math.min(TREG_PAGE, Math.max(10, room * 2));
  const r = await tregPeopleSearch(ctx.workspaceId, ctx.icp, size, (ctx.cursor.treg_token as string | undefined) ?? null);
  for (const p of r.leads) {
    if (ctx.isFull()) break;
    ctx.emitLead(p, { type: "lookalike", title: "Looks like your best customer", sourceUrl: p.profileUrl, dedupeKey: `lookalike:${ctx.agent.id}:${p.profileUrl}` });
  }
  // Out of pages: start again from the top next time (new people join the database).
  ctx.cursor.treg_token = r.token;
  ctx.cursor.last_import_at = new Date().toISOString();
}

/** Sales Navigator people-search URL for a boolean keyword query. */
export function salesNavSearchUrl(keywords: string): string {
  const q = keywords.replace(/[()]/g, (c) => c).trim();
  return `https://www.linkedin.com/sales/search/people?query=(keywords%3A${encodeURIComponent(q)})`;
}

/** Regular LinkedIn search pages read per run, and the deepest page before starting over. */
const PAGES_PER_RUN = 2;
const MAX_PAGE = 10;

/**
 * Fills capacity when signals run dry: imports people matching the ICP's Sales Navigator
 * keyword query into the agent's list through the existing paced importer. The agent
 * loop adopts those list members as low-intent "lookalike" leads.
 *
 * A Warm Lookalike agent stores the search built from its seed profile instead: a Sales
 * Navigator search goes through the importer the same way; a regular LinkedIn people search
 * (accounts without Sales Navigator) is read a couple of pages per run, leads emitted directly.
 */
export const lookalikeRunner: SourceRunner = async (ctx) => {
  if (tregEnabled()) return tregLookalike(ctx);
  const flagship = ctx.config.urls.find(isFlagshipSearchUrl) ?? null;
  if (flagship) {
    if (!ctx.browser || !ctx.agent.linkedin_account_id) throw new Error("Lookalike search needs a connected LinkedIn account on the agent");
    const { scrapePeopleSearch } = await import("@/lib/agents/lookalike-search");
    let pageNo = Number(ctx.cursor.page ?? 0);
    for (let i = 0; i < PAGES_PER_RUN && !ctx.isFull(); i++) {
      pageNo = pageNo >= MAX_PAGE ? 1 : pageNo + 1;
      const url = new URL(flagship);
      if (pageNo > 1) url.searchParams.set("page", String(pageNo)); else url.searchParams.delete("page");
      const people = await scrapePeopleSearch(ctx.browser, ctx.agent.linkedin_account_id, url.toString());
      if (!people.length) { pageNo = 0; break; }
      for (const p of people) {
        ctx.emitLead(
          { name: p.fullName ?? "LinkedIn member", profileUrl: p.linkedinUrl, title: p.title, company: p.company, location: p.location, profileImageUrl: p.profileImageUrl },
          { type: "lookalike", title: "Looks like your best customer", sourceUrl: p.linkedinUrl, dedupeKey: `lookalike:${ctx.agent.id}:${p.linkedinUrl}` },
        );
      }
    }
    ctx.cursor.page = pageNo;
    ctx.cursor.last_import_at = new Date().toISOString();
    return;
  }

  // The wizard's Warm Lookalike stores the full Sales Navigator search built from a seed profile.
  const searchUrl = ctx.config.urls.find((u) => /linkedin\.com\/sales\/search\/people\?/.test(u)) ?? null;
  const query = ctx.config.keywords[0] || ctx.icp?.sales_nav_keywords;
  if (!searchUrl && !query) throw new Error("Add a keyword query (or Sales Nav keywords in the ICP) for lookalike search");
  if (!ctx.agent.linkedin_account_id || !ctx.agent.list_id) throw new Error("Lookalike search needs a LinkedIn account with Sales Navigator on the agent");
  // A dead "running" import (worker stopped) no longer counts as active, or it would block
  // this source forever.
  if (hasActiveImport(ctx.db, ctx.agent.list_id)) return;
  const url = searchUrl ?? salesNavSearchUrl(query!);
  startImport(ctx.db, { listId: ctx.agent.list_id, accountId: ctx.agent.linkedin_account_id, salesNavUrl: url, enrich: false });
  ctx.cursor.last_query = searchUrl ? "lookalike search" : query;
  ctx.cursor.last_import_at = new Date().toISOString();
};
