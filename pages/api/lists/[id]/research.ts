import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { isAiBlockingError } from "@/lib/ai/client";
import { checkCriterion, listCompanies, MAX_CRITERIA, ResearchError, researchState, startResearch } from "@/lib/lists/deep-research";
import { recordAudit, requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";

// GET  /api/lists/:id/research                       → { run, results: { [targetId]: { verdict, summary } }, companies }
// POST /api/lists/:id/research { action: "check", criterion } → { ok, message }: is the criterion specific enough?
// POST /api/lists/:id/research { action: "start", criteria }  → { run_id }: research every company in the list
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), criterion: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("start"), criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(MAX_CRITERIA) }),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const listId = String(req.query.id);
  if (!requireWorkspaceEntity(res, ctx, "lists", listId)) return;
  if (req.method === "GET") return res.json({ ...researchState(listId, ctx.workspaceId), companies: listCompanies(listId, ctx.workspaceId).length });
  if (req.method !== "POST") { res.setHeader("Allow", ["GET", "POST"]); return res.status(405).end(); }
  const parsed = body.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  try {
    if (parsed.data.action === "check") return res.json(await checkCriterion(ctx.workspaceId, parsed.data.criterion));
    const runId = startResearch(ctx.workspaceId, listId, parsed.data.criteria);
    recordAudit(ctx, "list.deep_research", "list", listId, { criteria: parsed.data.criteria });
    return res.json({ run_id: runId });
  } catch (err) {
    if (err instanceof ResearchError) return res.status(err.status).json({ error: err.message });
    if (isAiBlockingError(err)) return res.status(400).json({ error: err.message });
    console.error("[lists/research]", err);
    return res.status(502).json({ error: "Deep research could not start. Please try again." });
  }
}
