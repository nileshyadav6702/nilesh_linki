import { hasActiveImport, startImport } from "@/lib/import-jobs";
import type { SourceRunner } from "@/lib/signals/sources/types";

/**
 * "Existing leads": contacts already in the workspace (lists, CSV imports) handed to the
 * agent. They skip discovery and go straight to scoring and drafting.
 */
export const existingListRunner: SourceRunner = async (ctx) => {
  if (!ctx.config.list_ids.length) throw new Error("Pick at least one list");
  const placeholders = ctx.config.list_ids.map(() => "?").join(",");
  const rows = ctx.db.prepare(`SELECT DISTINCT lt.target_id id FROM list_targets lt JOIN lists l ON l.id = lt.list_id
    WHERE l.workspace_id = ? AND lt.list_id IN (${placeholders})`).all(ctx.workspaceId, ...ctx.config.list_ids) as Array<{ id: string }>;
  const adopt = ctx.db.prepare(`UPDATE targets SET agent_id = ?, agent_status = 'new', agent_status_at = datetime('now'), lead_source = COALESCE(lead_source, 'list')
    WHERE id = ? AND workspace_id = ? AND (agent_id IS NULL OR agent_id = ?) AND agent_status IS NULL`);
  const link = ctx.db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");
  let adopted = 0;
  for (const r of rows) {
    if (adopt.run(ctx.agent.id, r.id, ctx.workspaceId, ctx.agent.id).changes) {
      adopted++;
      if (ctx.agent.list_id) link.run(ctx.agent.list_id, r.id);
    }
  }
  const mine = (ctx.db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ?").get(ctx.agent.id) as { n: number }).n;
  // A contact belongs to one agent at a time, so lists another agent already works are skipped.
  if (rows.length && !adopted && !mine) throw new Error("Every contact in these lists is already handled by another agent");
};

/** "Import from LinkedIn": a Sales Navigator list or search URL, imported through the paced importer. */
export const linkedinImportRunner: SourceRunner = async (ctx) => {
  const url = ctx.config.urls[0];
  if (!url || !/linkedin\.com\/sales\//.test(url)) throw new Error("Paste a Sales Navigator list or search URL");
  if (!ctx.agent.linkedin_account_id || !ctx.agent.list_id) throw new Error("This source needs a LinkedIn account on the agent");
  if (ctx.cursor.imported_url === url) return; // one-shot per URL
  // A dead "running" import (worker stopped) no longer counts as active, or it would block
  // this source forever.
  if (hasActiveImport(ctx.db, ctx.agent.list_id)) return;
  startImport(ctx.db, { listId: ctx.agent.list_id, accountId: ctx.agent.linkedin_account_id, salesNavUrl: url, enrich: false });
  ctx.cursor.imported_url = url;
};
