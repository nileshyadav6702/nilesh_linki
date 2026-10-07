import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { regenerateDraft } from "@/lib/agents/copilot";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { requireWorkspace } from "@/lib/workspace";

// POST /api/approvals/:id/regenerate { instruction? } → rewrite one step's draft ("Refine with AI")
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.slice(0, 500) : null;
  try {
    return res.json({ draft: await regenerateDraft(getDb(), ctx.workspaceId, String(req.query.id), instruction) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not rewrite the draft";
    const status = err instanceof AiNotConfiguredError ? 400 : message === "Draft not found" ? 404 : /already/.test(message) ? 409 : 502;
    return res.status(status).json({ error: message });
  }
}
