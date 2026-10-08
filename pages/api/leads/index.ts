import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { listLeads, parseLeadsQuery } from "@/lib/agents/leads-query";

// GET /api/leads?agent_id=&status=&step=&approval=&email_enrich=&phone_enrich=&signal_type=&verdict=&q=&sort=&limit=&offset=&facets=1
// The Leads feed: agent-sourced contacts with their signals, fit reasoning, pending drafts and
// where each one stands in its sequence. Params are validated in lib/agents/leads-query.ts.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const parsed = parseLeadsQuery(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  return res.json(listLeads(getDb(), ctx.workspaceId, parsed.query));
}
