import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const ctx=requireWorkspace(req,res,"manager"); if(!ctx)return;

  const db = getDb();
  const runId = req.query.id as string;
  if(!requireWorkspaceEntity(res,ctx,"runs",runId))return;
  const { target_ids } = req.body as { target_ids: string[] };

  if (!target_ids?.length) return res.status(400).json({ error: "target_ids required" });

  const placeholders = target_ids.map(() => "?").join(",");
  // Retry: reset all failed track-runs for these profiles back to in_progress
  const rpRows = db.prepare(
    `SELECT id FROM run_profiles WHERE run_id = ? AND target_id IN (${placeholders})`
  ).all(runId, ...target_ids) as { id: string }[];

  let retried = 0;
  for (const rp of rpRows) {
    const r = db.prepare(
      `UPDATE run_profile_tracks SET state = 'in_progress', error_message = NULL, next_step_at = NULL, retry_count = 0
       WHERE run_profile_id = ? AND state = 'failed'`
    ).run(rp.id);
    retried += r.changes;
  }

  // Retried leads only move in a run that is being worked.
  if (retried) db.prepare("UPDATE runs SET status = 'running', completed_at = NULL WHERE id = ? AND status = 'completed'").run(runId);
  return res.json({ ok: true, retried });
}
