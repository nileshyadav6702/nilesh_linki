import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";
import { enqueueBulkEnrich } from "@/lib/linkedin/bulk-enrich";
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
  // Queued, not started here: the account's LinkedIn worker reads it in bounded slices,
  // in turn with that account's outreach and within its daily profile_view budget.
  // A list already queued (a double click, or another account) is refused as before.
  if (!enqueueBulkEnrich(listId, account_id, db)) {
    return res.status(409).json({ error: "Enrichment is already running for this list or account" });
  }

  return res.json({ started: true, profiles: pending.c, queued: true });
}

export const config = {
  api: { responseLimit: false },
};
