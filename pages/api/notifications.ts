import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { alertItems } from "@/lib/notifications/alerts";
import { activityItems } from "@/lib/notifications/activity";
import type { FeedItem } from "@/lib/notifications/types";

export type NotificationItem = FeedItem & { unread: boolean };

// GET  /api/notifications → { alerts, items, unread }: what needs the user (kept until resolved),
//                            then what happened (daily outreach, replies, acceptances, new leads,
//                            meetings, finished campaigns, failures, bounces, unsubscribes).
// POST /api/notifications  { action: "read_all" } → mark everything read for this member.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") { res.setHeader("Allow", ["GET", "POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const db = getDb();
  const user = ctx.userId ?? "workspace";

  if (req.method === "POST") {
    if ((req.body ?? {}).action !== "read_all") return res.status(400).json({ error: "action must be read_all" });
    db.prepare(`INSERT INTO notification_reads (workspace_id, user_id, read_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET read_at = excluded.read_at`).run(ctx.workspaceId, user, new Date().toISOString());
    return res.json({ ok: true });
  }

  const readAt = (db.prepare("SELECT read_at FROM notification_reads WHERE workspace_id = ? AND user_id = ?").get(ctx.workspaceId, user) as { read_at: string } | undefined)?.read_at ?? null;
  // An alert with no known start counts as new until it is marked read once.
  const unread = (at: string | null) => (at ? !readAt || Date.parse(at) > Date.parse(readAt) : !readAt);
  const mark = (i: FeedItem): NotificationItem => ({ ...i, unread: unread(i.at) });
  const newest = (a: FeedItem, b: FeedItem) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0);

  const alerts = alertItems(db, ctx.workspaceId).sort(newest).map(mark);
  const items = activityItems(db, ctx.workspaceId).sort(newest).slice(0, 60).map(mark);
  return res.json({ alerts, items, unread: [...alerts, ...items].filter((i) => i.unread).length });
}
