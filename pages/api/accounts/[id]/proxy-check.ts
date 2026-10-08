import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { checkProxyReachable } from "@/lib/linkedin/proxy";
import { requireWorkspace } from "@/lib/workspace";

// POST /api/accounts/:id/proxy-check { proxy_url } → { ok, ms } | { ok: false, error }
// Reachability of the proxy from this server, before it is saved on the account.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "admin");
  if (!ctx) return;
  const exists = getDb().prepare("SELECT 1 FROM accounts WHERE id = ? AND workspace_id = ?").get(String(req.query.id), ctx.workspaceId);
  if (!exists) return res.status(404).json({ error: "Not found" });
  const proxyUrl = typeof req.body?.proxy_url === "string" ? req.body.proxy_url : "";
  return res.json(await checkProxyReachable(proxyUrl));
}
