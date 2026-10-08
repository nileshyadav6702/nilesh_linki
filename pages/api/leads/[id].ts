import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { enrollLead } from "@/lib/agents/enroll";
import { getLeadDetail } from "@/lib/agents/copilot";
import { enrichTargetEmail } from "@/lib/enrichment/waterfall";
import type { Agent } from "@/lib/agents/store";
import { recordAudit, requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// GET   /api/leads/:id → profile, company, signals, agent and the full sequence with drafts
// PATCH /api/leads/:id { action: 'enroll' | 'skip' | 'requalify' | 'find_email', reason? }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH" && req.method !== "GET") { res.setHeader("Allow", ["GET", "PATCH"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const id = String(req.query.id);
  if (!requireWorkspaceEntity(res, ctx, "targets", id)) return;
  const db = getDb();
  if (req.method === "GET") return res.json(getLeadDetail(db, ctx.workspaceId, id));
  const action = String(req.body?.action ?? "");
  const lead = db.prepare("SELECT id, agent_id FROM targets WHERE id = ?").get(id) as { id: string; agent_id: string | null };
  const agent = lead.agent_id ? db.prepare("SELECT * FROM agents WHERE id = ? AND workspace_id = ?").get(lead.agent_id, ctx.workspaceId) as Agent | undefined : undefined;

  if (action === "skip") {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : "Skipped by user";
    db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = ?, agent_status_at = datetime('now') WHERE id = ?").run(reason, id);
    db.prepare("UPDATE approval_queue SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE target_id = ? AND status = 'pending'").run(ctx.userId, id);
    recordAudit(ctx, "lead.skipped", "contact", id, { reason });
    return res.json({ ok: true });
  }
  if (action === "requalify") {
    db.prepare("UPDATE targets SET agent_status = 'new', scored_icp_id = NULL, skip_reason = NULL, agent_status_at = datetime('now') WHERE id = ?").run(id);
    return res.json({ ok: true });
  }
  if (action === "enroll") {
    if (!agent) return res.status(400).json({ error: "This contact is not managed by an agent" });
    const pending = (db.prepare("SELECT COUNT(*) n FROM approval_queue WHERE target_id = ? AND status = 'pending'").get(id) as { n: number }).n;
    if (pending) return res.status(409).json({ error: "Review the pending drafts first" });
    const r = enrollLead(db, agent, id);
    if (!r.enrolled) return res.status(400).json({ error: r.reason });
    recordAudit(ctx, "lead.enrolled", "contact", id);
    return res.json({ ok: true });
  }
  if (action === "remove") {
    db.transaction(() => {
      db.prepare("UPDATE targets SET agent_id = NULL, agent_status = NULL, skip_reason = 'Removed from campaign', agent_status_at = datetime('now') WHERE id = ?").run(id);
      if (agent?.list_id) db.prepare("DELETE FROM list_targets WHERE list_id = ? AND target_id = ?").run(agent.list_id, id);
      db.prepare(`UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Removed from campaign'
        WHERE run_profile_id IN (SELECT rp.id FROM run_profiles rp JOIN runs r ON r.id = rp.run_id WHERE rp.target_id = ? AND r.workspace_id = ?)
          AND state NOT IN ('completed','failed','skipped')`).run(id, ctx.workspaceId);
      db.prepare("UPDATE approval_queue SET status = 'rejected', decided_at = datetime('now') WHERE target_id = ? AND status = 'pending'").run(id);
    })();
    recordAudit(ctx, "lead.removed", "contact", id);
    return res.json({ ok: true });
  }
  if (action === "find_email") {
    const r = await enrichTargetEmail(db, ctx.workspaceId, id);
    return res.json({ found: !!r, ...r });
  }
  return res.status(400).json({ error: "Unknown action" });
}
