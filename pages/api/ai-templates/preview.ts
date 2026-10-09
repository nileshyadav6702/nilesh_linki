import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { previewTemplate } from "@/lib/ai-templates/preview";
import { CHANNELS, KINDS, LIMITS } from "@/lib/ai-templates/store";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// POST /api/ai-templates/preview { channel, kind, subject?, body, ai_instructions?, target_id } → { subject, body }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  if (!CHANNELS.includes(b.channel as never) || !KINDS.includes(b.kind as never)) return res.status(400).json({ error: "channel and kind are required" });
  const body = str(b.body, 20_000);
  if (!body?.trim()) return res.status(400).json({ error: "Write the template first" });
  const targetId = str(b.target_id, 100);
  if (!targetId || !requireWorkspaceEntity(res, ctx, "targets", targetId)) return targetId ? undefined : res.status(400).json({ error: "Pick a contact" });
  try {
    return res.json(await previewTemplate(getDb(), ctx.workspaceId, ctx.userId ?? null, {
      channel: b.channel as "linkedin" | "email", kind: b.kind as "icebreaker" | "followup" | "closing",
      subject: str(b.subject, LIMITS.subject), body, ai_instructions: str(b.ai_instructions, LIMITS.instructions), target_id: targetId,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate the preview";
    return res.status(err instanceof AiNotConfiguredError ? 400 : 502).json({ error: message });
  }
}
