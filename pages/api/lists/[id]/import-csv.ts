import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { importCsv, importCsvWithMapping, validateMapping } from "@/lib/csv-import";
import { requireWorkspace } from "@/lib/workspace";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const ctx = requireWorkspace(req, res, "member");
  if (!ctx) return;

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ? AND workspace_id = ?").get(listId, ctx.workspaceId) as { id: string } | undefined;
  if (!list) return res.status(404).json({ error: "List not found" });

  const { csv, mapping } = req.body as { csv?: string; mapping?: unknown };
  if (!csv || typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "csv content is required" });
  }

  if (mapping !== undefined) {
    const validated = validateMapping(mapping);
    if ("error" in validated) return res.status(400).json({ error: validated.error });
    const result = importCsvWithMapping(db, listId, ctx.workspaceId, csv, validated.mapping);
    return res.json(result);
  }

  const result = importCsv(db, listId, ctx.workspaceId, csv);
  res.json(result);
}

// CSV text is posted as JSON — raise the request body limit well above the 1MB default
// so large lists don't get silently rejected with a 413 before reaching the handler.
export const config = {
  api: { bodyParser: { sizeLimit: "25mb" }, responseLimit: false },
};

