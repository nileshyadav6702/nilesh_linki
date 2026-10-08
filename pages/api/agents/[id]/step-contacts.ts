import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { afterStepWhere, stepWindows } from "@/lib/agents/analytics";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/agents/:id/step-contacts?step_id= → the leads that completed this step and have not
// moved to the next one yet (the Campaign tab's "N contacts" on a step card).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent?.workflow_id) return res.status(404).json({ error: "Agent has no campaign" });
  const db = getDb();
  const w = stepWindows(db, agent.workflow_id).get(String(req.query.step_id ?? ""));
  if (!w) return res.status(404).json({ error: "Step not found" });
  const where = afterStepWhere(w);
  const contacts = db.prepare(`SELECT t.id, t.full_name, t.title, t.company, t.linkedin_url, t.profile_image_url, t.lead_score, t.agent_status,
      rt.current_step, rt.state, rt.last_step_at,
      (SELECT s.title FROM signals s WHERE s.target_id = t.id ORDER BY s.occurred_at DESC LIMIT 1) signal_title,
      (SELECT COUNT(*) FROM signals s WHERE s.target_id = t.id) signal_count
    FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id JOIN targets t ON t.id = rp.target_id
    WHERE r.workflow_id = ? AND r.status IN ('running','paused') AND rt.track = ? AND t.workspace_id = ? AND ${where.sql}
    GROUP BY t.id ORDER BY rt.last_step_at DESC LIMIT 500`).all(agent.workflow_id, w.track, ctx.workspaceId, ...where.params);
  return res.json({ contacts });
}
