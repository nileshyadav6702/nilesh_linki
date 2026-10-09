import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { deleteTemplate, getTemplate, templateInput, updateTemplate } from "@/lib/ai-templates/store";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET / PUT / DELETE /api/ai-templates/:id
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();
  const id = String(req.query.id);
  if (req.method === "GET") {
    const t = getTemplate(db, ctx.workspaceId, id);
    return t ? res.json(t) : res.status(404).json({ error: "Template not found" });
  }
  if (req.method === "PUT") {
    try {
      const t = updateTemplate(db, ctx.workspaceId, id, templateInput.parse(req.body ?? {}));
      if (!t) return res.status(404).json({ error: "Template not found" });
      recordAudit(ctx, "ai_template.updated", "ai_template", id, { name: t.name });
      return res.json(t);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ error: firstIssue(err, "Invalid template") });
      throw err;
    }
  }
  if (req.method === "DELETE") {
    if (!deleteTemplate(db, ctx.workspaceId, id)) return res.status(404).json({ error: "Template not found" });
    recordAudit(ctx, "ai_template.deleted", "ai_template", id);
    return res.status(204).end();
  }
  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end();
}
