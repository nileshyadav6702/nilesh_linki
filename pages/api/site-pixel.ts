import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { pixelSnippet, pixelToken } from "@/lib/signals/website-visits";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/site-pixel → the workspace's website-visitor snippet + recent identified visits
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const db = getDb();
  const origin = process.env.EMAIL_TRACKING_BASE_URL || process.env.NEXTAUTH_URL || `https://${req.headers.host}`;
  const token = pixelToken(db, ctx.workspaceId);
  const visits = db.prepare(`SELECT company_name, company_domain, COUNT(*) views, MAX(created_at) last_seen FROM website_visits
    WHERE workspace_id = ? AND company_name IS NOT NULL AND created_at >= date('now', '-30 days')
    GROUP BY company_name, company_domain ORDER BY last_seen DESC LIMIT 50`).all(ctx.workspaceId);
  const total = (db.prepare("SELECT COUNT(*) n FROM website_visits WHERE workspace_id = ? AND created_at >= date('now', '-30 days')").get(ctx.workspaceId) as { n: number }).n;
  return res.json({ snippet: pixelSnippet(origin.replace(/\/$/, ""), token), visits, total_views_30d: total });
}
