import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { isActivityCategory, listAgentActivity } from "@/lib/agents/activity-feed";
import { requireWorkspace } from "@/lib/workspace";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Whole number in [min, max], or the fallback when absent; null when present but invalid. */
function intParam(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

// GET /api/agents/:id/activity?category=website|discovery|campaign|setup&limit=1..100&offset=
// → { items, total, counts: { all, website, discovery, campaign, setup } }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const id = one(req.query.id) ?? "";
  if (!id || id.length > 100) return res.status(404).json({ error: "Agent not found" });
  const agent = getAgent(id, ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const rawCategory = one(req.query.category);
  if (rawCategory && rawCategory !== "all" && !isActivityCategory(rawCategory)) return res.status(400).json({ error: "Unknown category" });
  const limit = intParam(one(req.query.limit), 50, 1, 100);
  const offset = intParam(one(req.query.offset), 0, 0, 1_000_000);
  if (limit === null) return res.status(400).json({ error: "limit must be 1-100" });
  if (offset === null) return res.status(400).json({ error: "offset must be a non-negative integer" });

  const category = rawCategory && isActivityCategory(rawCategory) ? rawCategory : undefined;
  return res.json(listAgentActivity(getDb(), { workspaceId: ctx.workspaceId, agentId: agent.id, category, limit, offset }));
}
