import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { createTemplate, getMode, listTemplates, setMode, templateInput, templateUsage } from "@/lib/ai-templates/store";
import { EXAMPLES } from "@/lib/ai-templates/examples";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET   /api/ai-templates → { templates (with agents_using), mode, examples }
// POST  /api/ai-templates { name, channel, kind, subject?, body, ai_instructions? } → created
// PATCH /api/ai-templates { mode: "default" | "custom" } → which templates the AI writes from
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "GET") {
    const usage = templateUsage(db, ctx.workspaceId);
    return res.json({ templates: listTemplates(db, ctx.workspaceId).map((t) => ({ ...t, agents_using: usage[t.id] ?? 0 })), mode: getMode(db, ctx.workspaceId), examples: EXAMPLES });
  }
  if (req.method === "POST") {
    try {
      const t = createTemplate(db, ctx.workspaceId, templateInput.parse(req.body ?? {}));
      recordAudit(ctx, "ai_template.created", "ai_template", t.id, { name: t.name });
      return res.status(201).json(t);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ error: firstIssue(err, "Invalid template") });
      throw err;
    }
  }
  if (req.method === "PATCH") {
    const mode = req.body?.mode;
    if (mode !== "default" && mode !== "custom") return res.status(400).json({ error: "mode must be default or custom" });
    setMode(db, ctx.workspaceId, mode);
    recordAudit(ctx, "ai_template.mode", "workspace", ctx.workspaceId, { mode });
    return res.json({ mode });
  }
  res.setHeader("Allow", ["GET", "POST", "PATCH"]);
  return res.status(405).end();
}
