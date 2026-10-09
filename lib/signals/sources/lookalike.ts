import { hasActiveImport, startImport } from "@/lib/import-jobs";
import type { SourceRunner } from "@/lib/signals/sources/types";

/** Sales Navigator people-search URL for a boolean keyword query. */
export function salesNavSearchUrl(keywords: string): string {
  const q = keywords.replace(/[()]/g, (c) => c).trim();
  return `https://www.linkedin.com/sales/search/people?query=(keywords%3A${encodeURIComponent(q)})`;
}

/**
 * Fills capacity when signals run dry: imports people matching the ICP's Sales Navigator
 * keyword query into the agent's list through the existing paced importer. The agent
 * loop adopts those list members as low-intent "lookalike" leads.
 */
export const lookalikeRunner: SourceRunner = async (ctx) => {
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
