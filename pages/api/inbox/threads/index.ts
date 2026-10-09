import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { listThreads, type InboxFilter } from "@/lib/inbox/store";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/inbox/threads?scope=all|linkedin|email|linkedin:<id>|email:<id>&filter=received|interested|unread|all&q=&limit=&offset=
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const one = (k: string) => (typeof req.query[k] === "string" ? String(req.query[k]) : "");
  const filter = (["received", "interested", "unread", "all"].includes(one("filter")) ? one("filter") : "received") as InboxFilter;
  const scope = /^(all|linkedin|email)(:[\w-]{1,100})?$/.test(one("scope")) ? one("scope") : "all";
  const limit = Math.min(100, Math.max(1, Number(one("limit")) || 50));
  const offset = Math.max(0, Number(one("offset")) || 0);
  return res.json(listThreads(getDb(), ctx.workspaceId, { scope, filter, q: one("q").slice(0, 100) || null, limit, offset }));
}
