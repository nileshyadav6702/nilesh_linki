import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decideDraft } from "@/lib/agents/approvals";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET  /api/approvals?status=pending&agent_id= → drafts with the lead's context
// POST /api/approvals { ids: string[], decision: 'approve' | 'reject' } → bulk decision
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "GET") {
    const status = ["pending", "approved", "rejected", "consumed"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
    const agentId = typeof req.query.agent_id === "string" && req.query.agent_id ? req.query.agent_id : null;
    const rows = db.prepare(`SELECT q.*, t.full_name, t.headline, t.company, t.linkedin_url, t.email, t.lead_score, t.fit_reason, a.name agent_name, a.mode agent_mode,
        s.title signal_title, s.snippet signal_snippet, s.source_url signal_url, s.type signal_type
      FROM approval_queue q JOIN targets t ON t.id = q.target_id LEFT JOIN agents a ON a.id = q.agent_id LEFT JOIN signals s ON s.id = q.signal_id
      WHERE q.workspace_id = ? AND q.status = ? AND (? IS NULL OR q.agent_id = ?)
      ORDER BY t.lead_score DESC, q.created_at LIMIT 200`).all(ctx.workspaceId, status, agentId, agentId);
    return res.json(rows);
  }
  if (req.method === "POST") {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    const decision = req.body?.decision === "reject" ? "reject" : req.body?.decision === "approve" ? "approve" : null;
    if (!ids.length || !decision) return res.status(400).json({ error: "ids and decision are required" });
    const results = ids.map((id) => ({ id, ...decideDraft(db, ctx.workspaceId, id, decision, ctx.userId) }));
    recordAudit(ctx, `drafts.bulk_${decision}`, "approval_queue", undefined, { count: ids.length });
    return res.json({ results });
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
