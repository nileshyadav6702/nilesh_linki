import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// GET /api/targets/:id/signals → the contact's buying signals + agent scoring
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const id = String(req.query.id);
  if (!requireWorkspaceEntity(res, ctx, "targets", id)) return;
  const db = getDb();
  const score = db.prepare(`SELECT t.fit_score, t.fit_verdict, t.fit_reason, t.fit_confidence, t.intent_score, t.lead_score, t.agent_status, t.lead_source, a.id agent_id, a.name agent_name
    FROM targets t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = ?`).get(id);
  const signals = db.prepare("SELECT id, type, title, snippet, source_url, occurred_at, weight FROM signals WHERE target_id = ? ORDER BY occurred_at DESC LIMIT 50").all(id);
  return res.json({ score, signals });
}
