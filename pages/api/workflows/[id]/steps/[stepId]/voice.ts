import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// GET    /api/workflows/:id/steps/:stepId/voice → the recorded audio (for the player)
// POST   { audio_base64, mime, duration_ms } → store / replace the recording of a voice step
// DELETE → remove it

const MAX_BYTES = 1_500_000;
const MAX_MS = 60_000;
const MIME = /^audio\/(webm|ogg|mp4|mpeg|wav)(;\s*codecs=[\w.,-]+)?$/i;

export const config = { api: { bodyParser: { sizeLimit: "3mb" } } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const workflowId = String(req.query.id);
  if (!requireWorkspaceEntity(res, ctx, "workflows", workflowId)) return;
  const stepId = String(req.query.stepId);
  const db = getDb();
  const step = db.prepare("SELECT step_type FROM workflow_steps WHERE id = ? AND workflow_id = ?").get(stepId, workflowId) as { step_type: string } | undefined;
  if (!step) return res.status(404).json({ error: "Step not found" });

  if (req.method === "GET") {
    const media = db.prepare("SELECT mime, data FROM step_media WHERE step_id = ?").get(stepId) as { mime: string; data: Buffer } | undefined;
    if (!media) return res.status(404).json({ error: "No recording" });
    res.setHeader("Content-Type", media.mime);
    res.setHeader("Content-Length", String(media.data.length));
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(media.data);
  }

  if (req.method === "POST") {
    if (step.step_type !== "voice") return res.status(400).json({ error: "Only voice-message steps take a recording" });
    const { audio_base64, mime, duration_ms } = (req.body ?? {}) as { audio_base64?: unknown; mime?: unknown; duration_ms?: unknown };
    if (typeof mime !== "string" || !MIME.test(mime)) return res.status(400).json({ error: "Unsupported audio format" });
    if (typeof audio_base64 !== "string" || !audio_base64) return res.status(400).json({ error: "audio_base64 is required" });
    const ms = Math.round(Number(duration_ms));
    if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_MS + 2000) return res.status(400).json({ error: "A voice message must be under 60 seconds" });
    const data = Buffer.from(audio_base64.replace(/^data:[^,]*,/, ""), "base64");
    if (!data.length) return res.status(400).json({ error: "Empty recording" });
    if (data.length > MAX_BYTES) return res.status(413).json({ error: "Recording is too large" });
    db.prepare(`INSERT INTO step_media (step_id, mime, data, duration_ms) VALUES (?, ?, ?, ?)
      ON CONFLICT(step_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, duration_ms = excluded.duration_ms, created_at = datetime('now')`)
      .run(stepId, mime.toLowerCase(), data, Math.min(ms, MAX_MS));
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM step_media WHERE step_id = ?").run(stepId);
    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end();
}
