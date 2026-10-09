import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { recordAudit, requireWorkspace } from "@/lib/workspace";
import { getWorkspacePref, setWorkspacePref } from "@/lib/workspace-prefs";

/**
 * Workspace-wide agent preferences. Each one is a per-agent setting; saving it here sets it
 * on every agent in the workspace. Reading reports it as on when every agent has it on
 * (or, with no agents yet, the agents' default).
 */

const PREFS = {
  auto_enrich_emails: { column: "enrich_emails", defaultOn: true },
  exclude_first_degree: { column: "exclude_first_degree", defaultOn: true },
} as const;
type Pref = keyof typeof PREFS;

// GET   /api/settings/workspace → { prefs: { auto_enrich_emails, exclude_first_degree, company_dedup }, agents }
// PATCH /api/settings/workspace { auto_enrich_emails?, exclude_first_degree?, company_dedup?: boolean }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  const db = getDb();
  const read = () => {
    const agents = (db.prepare("SELECT COUNT(*) n FROM agents WHERE workspace_id = ?").get(ctx.workspaceId) as { n: number }).n;
    const prefs = Object.fromEntries((Object.keys(PREFS) as Pref[]).map((k) => {
      if (!agents) return [k, PREFS[k].defaultOn];
      const off = (db.prepare(`SELECT COUNT(*) n FROM agents WHERE workspace_id = ? AND COALESCE(${PREFS[k].column}, 0) = 0`).get(ctx.workspaceId) as { n: number }).n;
      return [k, off === 0];
    })) as Record<Pref, boolean>;
    return { prefs: { ...prefs, company_dedup: getWorkspacePref(db, ctx.workspaceId, "company_dedup") }, agents };
  };
  if (req.method === "GET") return res.json(read());
  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const changes = (Object.keys(PREFS) as Pref[]).filter((k) => body[k] !== undefined);
    for (const k of changes) if (typeof body[k] !== "boolean") return res.status(400).json({ error: `${k} must be true or false` });
    if (body.company_dedup !== undefined && typeof body.company_dedup !== "boolean") return res.status(400).json({ error: "company_dedup must be true or false" });
    db.transaction(() => {
      for (const k of changes) db.prepare(`UPDATE agents SET ${PREFS[k].column} = ?, updated_at = datetime('now') WHERE workspace_id = ?`).run(body[k] ? 1 : 0, ctx.workspaceId);
      if (typeof body.company_dedup === "boolean") setWorkspacePref(db, ctx.workspaceId, "company_dedup", body.company_dedup);
    })();
    if (changes.length || body.company_dedup !== undefined) recordAudit(ctx, "workspace.preferences", "workspace", ctx.workspaceId, { ...Object.fromEntries(changes.map((k) => [k, body[k]])), company_dedup: body.company_dedup });
    return res.json(read());
  }
  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
