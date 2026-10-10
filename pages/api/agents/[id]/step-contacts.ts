import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { atStepWhere, stepWindows } from "@/lib/agents/analytics";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/agents/:id/step-contacts?step_id= → the leads at this step (see atStepWhere): completed it and not
// moved to the next one yet (the Campaign tab's "N contacts" on a step card).
// &accepted=1 on an invitation step → everyone who accepted it, wherever they are now ("N accepted").
// Each row says where the lead is in the sequence: "Step 2 · Message", plus whether they accepted the invitation.

const STEP_NAME: Record<string, string> = {
  connect: "Connection Request", message: "Message", sales_inmail: "InMail", email: "Email", visit: "Visit Profile", like_posts: "Like Posts", voice: "Voice Message",
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent?.workflow_id) return res.status(404).json({ error: "Agent has no campaign" });
  const db = getDb();
  const w = stepWindows(db, agent.workflow_id).get(String(req.query.step_id ?? ""));
  if (!w) return res.status(404).json({ error: "Step not found" });
  const stepId = String(req.query.step_id);
  const step = db.prepare("SELECT step_type, step_order FROM workflow_steps WHERE id = ?").get(stepId) as { step_type: string; step_order: number } | undefined;
  const accepted = req.query.accepted === "1" && step?.step_type === "connect";
  const where = accepted
    ? { sql: "t.connected_at IS NOT NULL AND (rt.state = 'completed' OR rt.current_step >= ? OR EXISTS (SELECT 1 FROM linkedin_actions la WHERE la.track_id = rt.id AND la.step_id = ? AND la.type = 'connect' AND la.status IN ('sent','uncertain')))", params: [step.step_order, stepId] as unknown[] }
    : atStepWhere(stepId, step?.step_type ?? "", w);
  const rows = db.prepare(`SELECT t.id, t.full_name, t.title, t.company, t.linkedin_url, t.profile_image_url, t.lead_score, t.agent_status, t.agent_id,
      t.connected_at IS NOT NULL accepted, rt.current_step, rt.state, rt.last_step_at, rt.next_step_at, rt.wait_reason, rt.error_message, rp.created_at enrolled_at,
      (SELECT s.title FROM signals s WHERE s.target_id = t.id ORDER BY COALESCE(s.weight, s.score, 0) DESC, s.occurred_at DESC LIMIT 1) signal_title,
      (SELECT COUNT(*) FROM signals s WHERE s.target_id = t.id) signal_count
    FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id JOIN targets t ON t.id = rp.target_id
    WHERE r.workflow_id = ? AND r.status IN ('running','paused') AND rt.track = ? AND t.workspace_id = ? AND ${where.sql}
    GROUP BY t.id ORDER BY rp.created_at, t.id LIMIT 500`).all(agent.workflow_id, w.track, ctx.workspaceId, ...where.params) as Array<Record<string, unknown> & { current_step: number; state: string }>;

  // The track's steps in order: a lead "is at" the last action step before its pointer (the one it
  // completed or is waiting on), else the first one ahead. Numbered among action steps, like the cards.
  const steps = db.prepare("SELECT step_type FROM workflow_steps WHERE workflow_id = ? AND track = ? ORDER BY step_order").all(agent.workflow_id, w.track) as Array<{ step_type: string }>;
  const actionNo: number[] = [];
  let n = 0;
  for (const s of steps) actionNo.push(s.step_type === "delay" ? 0 : ++n);
  const at = (current: number, state: string) => {
    const cap = state === "completed" ? steps.length : current;
    for (let i = Math.min(cap, steps.length) - 1; i >= 0; i--) if (actionNo[i]) return i;
    return steps.findIndex((s) => s.step_type !== "delay");
  };
  const contacts = rows.map((r) => {
    const i = at(r.current_step, r.state);
    return { ...r, accepted: !!r.accepted, step_number: i >= 0 ? actionNo[i] : null, step_name: i >= 0 ? STEP_NAME[steps[i].step_type] ?? steps[i].step_type : null };
  });
  return res.json({ contacts });
}
