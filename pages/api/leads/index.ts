import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

const STATUSES = new Set(["new", "qualified", "disqualified", "drafted", "approved", "enrolled", "skipped"]);

// GET /api/leads?agent_id=&status=&signal_type=&verdict=&q=&limit=&offset=
// The Leads feed: agent-sourced contacts ranked by lead score, each with its signals,
// fit reasoning and any pending first-touch drafts ("why this lead").
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const db = getDb();
  const q = req.query;
  const where = ["t.workspace_id = ?", "t.agent_id IS NOT NULL"];
  const params: unknown[] = [ctx.workspaceId];
  if (typeof q.agent_id === "string" && q.agent_id) { where.push("t.agent_id = ?"); params.push(q.agent_id); }
  if (typeof q.status === "string" && STATUSES.has(q.status)) { where.push("t.agent_status = ?"); params.push(q.status); }
  else if (q.status !== "all") where.push("t.agent_status NOT IN ('disqualified','skipped')");
  if (typeof q.verdict === "string" && ["strong", "possible", "poor"].includes(q.verdict)) { where.push("t.fit_verdict = ?"); params.push(q.verdict); }
  if (typeof q.signal_type === "string" && q.signal_type) { where.push("EXISTS (SELECT 1 FROM signals s WHERE s.target_id = t.id AND s.type = ?)"); params.push(q.signal_type); }
  if (typeof q.q === "string" && q.q.trim()) {
    const like = `%${q.q.trim().slice(0, 100)}%`;
    where.push("(t.full_name LIKE ? OR t.company LIKE ? OR t.headline LIKE ?)"); params.push(like, like, like);
  }
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
  const offset = Math.max(0, Number(q.offset ?? 0));
  const total = (db.prepare(`SELECT COUNT(*) n FROM targets t WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
  const leads = db.prepare(`SELECT t.id, t.full_name, t.first_name, t.headline, t.title, t.company, t.location, t.linkedin_url, t.email, t.email_status, t.phone,
        t.profile_image_url, t.fit_score, t.fit_verdict, t.fit_reason, t.fit_confidence, t.intent_score, t.lead_score, t.agent_id,
        t.agent_status, t.agent_status_at, t.skip_reason, t.lead_source, t.created_at, a.name agent_name,
        (SELECT ws.step_type FROM run_profile_tracks rt
          JOIN run_profiles rp ON rp.id = rt.run_profile_id
          JOIN runs r ON r.id = rp.run_id
          JOIN workflow_steps ws ON ws.workflow_id = r.workflow_id AND ws.track = rt.track AND ws.step_order = rt.current_step + 1
          WHERE rp.target_id = t.id AND rt.state = 'in_progress'
          ORDER BY rt.next_step_at LIMIT 1) outreach_step
      FROM targets t LEFT JOIN agents a ON a.id = t.agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(t.lead_score, t.intent_score) DESC, t.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>;
  const signalsStmt = db.prepare("SELECT id, type, title, snippet, source_url, occurred_at, weight FROM signals WHERE target_id = ? ORDER BY occurred_at DESC LIMIT 5");
  const draftsStmt = db.prepare("SELECT id, channel, subject, body, status, auto_approve_at FROM approval_queue WHERE target_id = ? AND status = 'pending' ORDER BY created_at");
  return res.json({
    total,
    leads: leads.map((l) => ({ ...l, signals: signalsStmt.all(l.id), drafts: draftsStmt.all(l.id) })),
  });
}
