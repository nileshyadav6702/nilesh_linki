import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";
import { acquireEnrichLock, enrichList } from "@/lib/linkedin/enrich";
import { discoveryPausedUntil } from "@/lib/linkedin/budget";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const workspace=requireWorkspace(req,res,"member"); if(!workspace)return;

  const db = getDb();
  const listId = req.query.id as string;
  if(!requireWorkspaceEntity(res,workspace,"lists",listId))return;

  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: "account_id required" });

  const account = db.prepare("SELECT * FROM accounts WHERE id = ? AND workspace_id = ?").get(account_id,workspace.workspaceId) as
    | { cookies_json: string | null; is_authenticated: number }
    | undefined;
  if (!account) return res.status(400).json({ error: "Account not found" });
  if (!account.is_authenticated || !account.cookies_json) {
    return res.status(400).json({ error: "Account not authenticated" });
  }

  const pending = db.prepare(`
    SELECT COUNT(*) as c FROM targets t
    JOIN list_targets lt ON lt.target_id = t.id
    WHERE lt.list_id = ? AND t.sales_nav_url IS NOT NULL AND t.enriched_profile_at IS NULL
  `).get(listId) as { c: number };

  const paused = discoveryPausedUntil(account_id);
  if (paused) return res.status(409).json({ error: `LinkedIn is limiting this account until ${paused.until}. Try again later.` });
  // One bulk run per list and per account: a double click must not start a second browser loop.
  const release = acquireEnrichLock(listId, account_id);
  if (!release) return res.status(409).json({ error: "Enrichment is already running for this list or account" });

  // Respond immediately — enrichment runs in background
  res.json({ started: true, profiles: pending.c });

  // Fire and forget — do not await
  setImmediate(async () => {
    try {
      const { getSessionContext } = await import("@/lib/linkedin/session");
      const ctx = await getSessionContext(account_id);
      const r = await enrichList(ctx, listId, 2000, undefined, account_id);
      if (r.stopped) console.warn(`[enrich] list ${listId} stopped early (${r.stopped}${r.reason ? `: ${r.reason}` : ""})`);
    } catch (err) {
      console.error("[enrich] background enrichment failed:", err instanceof Error ? err.message : err);
    } finally {
      release();
    }
  });
}

export const config = {
  api: { responseLimit: false },
};
