import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { agentSeriesRange } from "@/lib/agents/analytics";
import { requireWorkspace } from "@/lib/workspace";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

// GET /api/agents/:id/series?from=YYYY-MM-DD&to=YYYY-MM-DD → daily leads found and sends (the Overview chart's "Select dates").
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const from = String(req.query.from ?? ""); const to = String(req.query.to ?? "");
  if (!DAY.test(from) || !DAY.test(to) || from > to) return res.status(400).json({ error: "Pick a start and an end date" });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_DAYS) return res.status(400).json({ error: "Pick a range of at most a year" });
  return res.json({ series: agentSeriesRange(getDb(), agent.id, from, to) });
}
