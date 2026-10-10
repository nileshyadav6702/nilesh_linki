import type { NextApiRequest, NextApiResponse } from "next";
import { applyPlaces, capturePlaces, stepIds } from "@/lib/linkedin/campaign/sequence-remap";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity, templatesBelongToWorkspace } from "@/lib/workspace";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx=requireWorkspace(req,res,"member"); if(!ctx)return;
  const db = getDb();
  const workflowId=req.query.id as string;
  if(!requireWorkspaceEntity(res,ctx,"workflows",workflowId))return;
  const stepId = req.query.stepId as string;
  const step=db.prepare("SELECT 1 FROM workflow_steps WHERE id=? AND workflow_id=?").get(stepId,workflowId);
  if(!step)return res.status(404).json({error:"Step not found"});

  if (req.method === "PUT") {
    // True partial-merge: only update columns present in the body. Previously connect_note,
    // message_body, email_subject and email_body were assigned directly, so updating just
    // email_body silently wiped email_subject (and vice versa).
    const body = req.body as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    if (has("template_id") && !templatesBelongToWorkspace(ctx, [body.template_id])) return res.status(400).json({ error: "Unknown template" });
    const sets: string[] = []; const params: unknown[] = [];
    const put = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };
    for (const col of ["step_type", "template_id", "delay_seconds", "step_order", "connect_note", "message_body", "email_subject", "email_body"]) {
      if (has(col)) put(col, body[col] ?? null);
    }
    if (has("ai_enabled")) put("ai_enabled", body.ai_enabled ? 1 : 0);
    const int = (k: string, min: number, max: number) => { const n = Math.round(Number(body[k])); if (Number.isFinite(n)) put(k, Math.min(max, Math.max(min, n))); };
    if (has("ai_template_id")) {
      const t = body.ai_template_id;
      if (t !== null && t !== "none" && !(typeof t === "string" && db.prepare("SELECT 1 FROM ai_templates WHERE id = ? AND workspace_id = ?").get(t, ctx.workspaceId))) return res.status(400).json({ error: "Unknown AI template" });
      put("ai_template_id", t ?? null);
    }
    if (has("like_count")) int("like_count", 1, 3);
    if (has("skip_after_days")) int("skip_after_days", 0, 60);
    if (has("withdraw_after_days")) int("withdraw_after_days", 0, 90);
    // 'fixed' = the same text for everyone: the agent stops drafting this step per lead.
    if (has("send_mode")) put("send_mode", body.send_mode === "fixed" ? "fixed" : "ai");
    if (has("email_delivery_mode")) {
      const mode = body.email_delivery_mode === "enhanced" ? "enhanced" : "plain";
      put("email_delivery_mode", mode);
      if (mode === "plain") { put("email_track_opens", 0); put("email_track_clicks", 0); }
    }
    if (has("email_track_opens") && body.email_delivery_mode !== "plain") put("email_track_opens", body.email_track_opens ? 1 : 0);
    if (has("email_track_clicks") && body.email_delivery_mode !== "plain") put("email_track_clicks", body.email_track_clicks ? 1 : 0);
    if (sets.length === 0) return res.json({ ok: true });
    db.prepare(`UPDATE workflow_steps SET ${sets.join(", ")} WHERE id = ?`).run(...params, stepId);
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    // Keep step_order dense and move no lead (lib/linkedin/campaign/sequence-remap.ts).
    const row = db.prepare("SELECT workflow_id, track FROM workflow_steps WHERE id = ?").get(stepId) as { workflow_id: string; track: string } | undefined;
    if (!row) return res.json({ ok: true });
    db.transaction(() => {
      const oldIds = stepIds(db, row.workflow_id, row.track);
      const places = capturePlaces(db, row.workflow_id, row.track, oldIds);
      db.prepare("DELETE FROM workflow_steps WHERE id = ?").run(stepId);
      const newIds = oldIds.filter((id) => id !== stepId);
      const order = db.prepare("UPDATE workflow_steps SET step_order = ? WHERE id = ?");
      newIds.forEach((id, i) => order.run(i + 1, id));
      applyPlaces(db, places, newIds);
    })();
    return res.json({ ok: true });
  }

  res.status(405).end();
}
