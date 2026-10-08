import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { LeadSourceError } from "@/lib/agents/lead-sources";
import { importAgentCsv } from "@/lib/agents/lead-imports";
import { validateMapping } from "@/lib/csv-import";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// POST /api/agents/:id/import-csv { csv, mapping }
// Imports the rows into the "<agent> - CSV Import" list (created once, then reused), attaches
// that list to the agent, and returns the real counts. The server re-validates every row and
// dedupes against the whole workspace by canonical LinkedIn URL and email.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const db = getDb();
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const { csv, mapping } = (req.body ?? {}) as { csv?: unknown; mapping?: unknown };
  if (typeof csv !== "string" || !csv.trim()) return res.status(400).json({ error: "csv content is required" });
  const validated = validateMapping(mapping);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  try {
    const result = importAgentCsv(db, agent, csv, validated.mapping);
    recordAudit(ctx, "agent.csv_import", "agent", agent.id, { list_id: result.list_id, imported: result.imported, duplicates: result.duplicates, skipped: result.errors.length });
    return res.json(result);
  } catch (err) {
    if (err instanceof LeadSourceError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}

// 10MB of CSV plus JSON escaping overhead.
export const config = { api: { bodyParser: { sizeLimit: "14mb" } } };
