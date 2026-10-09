import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

export interface NotificationItem { id: string; kind: "reply" | "approval"; title: string; text: string | null; href: string; at: string | null; photo?: string | null }

// GET /api/notifications → unread replies (inbox) and messages waiting for approval (Copilot), newest first.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const db = getDb();
  const replies = db.prepare(`SELECT id, participant_name name, participant_photo photo, snippet, last_message_at at FROM inbox_threads
    WHERE workspace_id = ? AND unread = 1 AND has_inbound = 1 AND deleted = 0 AND archived = 0 ORDER BY last_message_at DESC LIMIT 8`)
    .all(ctx.workspaceId) as Array<{ id: string; name: string | null; photo: string | null; snippet: string | null; at: string | null }>;
  const pending = db.prepare(`SELECT COUNT(DISTINCT target_id) n, MAX(created_at) at FROM approval_queue WHERE workspace_id = ? AND status = 'pending'`)
    .get(ctx.workspaceId) as { n: number; at: string | null };
  const items: NotificationItem[] = replies.map((r) => ({
    id: `reply:${r.id}`, kind: "reply", title: `${r.name ?? "Someone"} replied`, text: r.snippet, href: "/inbox", at: r.at, photo: r.photo,
  }));
  if (pending.n) items.push({ id: "approval", kind: "approval", title: `${pending.n} lead${pending.n === 1 ? "" : "s"} waiting for your review`, text: "Approve or reject their messages in Copilot.", href: "/copilot", at: pending.at });
  items.sort((a, b) => ((a.at ?? "").replace(" ", "T") < (b.at ?? "").replace(" ", "T") ? 1 : -1));
  return res.json({ items, unread: replies.length + (pending.n ? 1 : 0) });
}
