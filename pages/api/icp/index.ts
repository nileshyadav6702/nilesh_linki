import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { getLatestIcp, getIcp, listIcpVersions, saveIcp } from "@/lib/icp/store";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET  /api/icp            → latest ICP (or ?id=) + version list
// POST /api/icp            → save an edited ICP as a new version { data, website_url }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "manager");
  if (!ctx) return;
  if (req.method === "GET") {
    const id = typeof req.query.id === "string" ? req.query.id : null;
    return res.json({ icp: id ? getIcp(id, ctx.workspaceId) : getLatestIcp(ctx.workspaceId), versions: listIcpVersions(ctx.workspaceId) });
  }
  if (req.method === "POST") {
    const body = (req.body ?? {}) as { data?: unknown; website_url?: unknown };
    try {
      const saved = saveIcp(ctx.workspaceId, body.data, typeof body.website_url === "string" ? body.website_url.slice(0, 400) : null, ctx.userId);
      recordAudit(ctx, "icp.saved", "icp", saved.id, { version: saved.version });
      return res.status(201).json(saved);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ error: firstIssue(err, "Invalid ICP") });
      throw err;
    }
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
