import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { copilotBoard } from "@/lib/agents/copilot-board";
import { requireWorkspace } from "@/lib/workspace";

// GET /api/copilot?mode=autopilot|copilot&account_id= → the Copilot board for one tab:
//   { items, active, activeInMode, nextLaunch }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  const mode = req.query.mode === "copilot" ? "copilot" : "autopilot";
  const accountId = typeof req.query.account_id === "string" && req.query.account_id ? req.query.account_id : null;
  return res.json(copilotBoard(getDb(), ctx.workspaceId, mode, accountId));
}
