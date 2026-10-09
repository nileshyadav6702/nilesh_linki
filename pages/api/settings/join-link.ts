import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { regenerateJoinLink, revokeJoinLink } from "@/lib/workspace-join-links";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// POST   /api/settings/join-link → a new invite link (the previous one stops working)
// DELETE /api/settings/join-link → turn the invite link off
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, "admin");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "POST") {
    const link = regenerateJoinLink(db, ctx.workspaceId, ctx.userId ?? null);
    recordAudit(ctx, "workspace.join_link_regenerated", "workspace", ctx.workspaceId);
    return res.status(201).json({ uses: link.uses, max_uses: link.max_uses, created_at: link.created_at, path: `/join/${encodeURIComponent(link.token)}` });
  }
  if (req.method === "DELETE") {
    revokeJoinLink(db, ctx.workspaceId);
    recordAudit(ctx, "workspace.join_link_revoked", "workspace", ctx.workspaceId);
    return res.status(204).end();
  }
  res.setHeader("Allow", ["POST", "DELETE"]);
  return res.status(405).end();
}
