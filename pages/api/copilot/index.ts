import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { copilotQueue } from "@/lib/agents/copilot";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/copilot?agent_id= → contacts with drafts awaiting review, best first
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const agentId = typeof req.query.agent_id === "string" && req.query.agent_id ? req.query.agent_id : null;
  return res.json(copilotQueue(getDb(), ctx.workspaceId, agentId));
}
