import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getThread, setTriage, TRIAGE_FIELDS } from "@/lib/inbox/store";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET   /api/inbox/threads/:id            → thread + messages; marks it read. ?history=1 also loads older LinkedIn messages.
// PATCH /api/inbox/threads/:id { unread?, interested?, archived?, deleted? }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();
  const id = String(req.query.id);
  if (req.method === "GET") {
    let found = getThread(db, ctx.workspaceId, id);
    if (!found) return res.status(404).json({ error: "Conversation not found" });
    if (req.query.history === "1" && found.thread.channel === "linkedin") {
      try {
        const { fetchLinkedInThread } = await import("@/lib/inbox/linkedin-sync");
        if (await fetchLinkedInThread(id)) found = getThread(db, ctx.workspaceId, id)!;
      } catch { /* account busy or LinkedIn unavailable: show what we have */ }
    }
    if (found.thread.unread) setTriage(db, ctx.workspaceId, id, { unread: false });
    return res.json({ ...found, thread: { ...found.thread, unread: 0 } });
  }
  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch = Object.fromEntries(TRIAGE_FIELDS.filter((f) => typeof body[f] === "boolean").map((f) => [f, body[f] as boolean]));
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update" });
    if (!setTriage(db, ctx.workspaceId, id, patch)) return res.status(404).json({ error: "Conversation not found" });
    recordAudit(ctx, "inbox.thread_updated", "inbox_thread", id, patch);
    return res.json({ ok: true });
  }
  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
