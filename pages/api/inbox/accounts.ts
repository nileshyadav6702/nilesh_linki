import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { accountCounts } from "@/lib/inbox/store";
import { inboxSyncStatus, syncWorkspaceInbox } from "@/lib/inbox/sync";
import { requireWorkspace } from "@/lib/workspace";

// GET  /api/inbox/accounts → connected accounts with conversation counts and sync status
// POST /api/inbox/accounts → sync every account now (in the background)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  if (req.method === "GET") return res.json({ ...accountCounts(getDb(), ctx.workspaceId), sync: inboxSyncStatus(ctx.workspaceId) });
  if (req.method === "POST") return res.json({ started: syncWorkspaceInbox(ctx.workspaceId) });
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
