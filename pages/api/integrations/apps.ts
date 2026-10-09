import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { appStates } from "@/lib/integrations/store";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/integrations/apps → connection state per app (secrets masked) for the Integrations page.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
  return res.json({ apps: appStates(getDb(), ctx.workspaceId), can_edit: ctx.role === "owner" || ctx.role === "admin", oauth_callback_base: `${base}/api/integrations/oauth/` });
}
