import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { findParticipantContact } from "@/lib/inbox/store";

// GET /api/inbox/threads/:id/contact → the workspace contact this conversation is with (the
// inbox's Contact Information panel), or { contact: null }. A thread synced before the person
// became a contact is linked here, by LinkedIn URL or email.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const db = getDb();
  const t = db.prepare("SELECT id, target_id, participant_url, participant_email FROM inbox_threads WHERE id = ? AND workspace_id = ?").get(String(req.query.id), ctx.workspaceId) as
    { id: string; target_id: string | null; participant_url: string | null; participant_email: string | null } | undefined;
  if (!t) return res.status(404).json({ error: "Conversation not found" });

  let targetId = t.target_id;
  if (!targetId) {
    targetId = findParticipantContact(db, ctx.workspaceId, t.participant_url, t.participant_email);
    if (targetId) db.prepare("UPDATE inbox_threads SET target_id = ? WHERE id = ?").run(targetId, t.id);
  }
  if (!targetId) return res.json({ contact: null });

  const contact = db.prepare(`SELECT t.id, t.full_name, t.title, t.headline, t.location, t.linkedin_url, t.profile_image_url, t.email,
      COALESCE(t.company, c.name) company, c.logo_url company_logo, c.location company_location
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ? AND t.workspace_id = ?`).get(targetId, ctx.workspaceId) as Record<string, unknown> | undefined;
  if (!contact) return res.json({ contact: null });
  // The signal that counts most: heaviest type, then the newest.
  const signal = db.prepare("SELECT type, title, occurred_at FROM signals WHERE target_id = ? ORDER BY COALESCE(weight, score, 0) DESC, occurred_at DESC LIMIT 1").get(targetId) ?? null;
  return res.json({ contact: { ...contact, location: contact.location ?? contact.company_location, signal } });
}
