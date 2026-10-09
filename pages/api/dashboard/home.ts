import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { dashboardSummary, setDealSize } from "@/lib/dashboard/summary";
import { parsePeriod } from "@/lib/insights/report";
import { requireWorkspace } from "@/lib/workspace";

// GET   /api/dashboard/home?from=YYYY-MM-DD&to=YYYY-MM-DD  → home dashboard (default last 30 days)
// PATCH /api/dashboard/home { deal_size: number | null }   → average deal size for "Pipeline generated"
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const ctx = requireWorkspace(req, res, "viewer");
    if (!ctx) return;
    return res.json(dashboardSummary(getDb(), ctx.workspaceId, parsePeriod(req.query.from, req.query.to)));
  }
  if (req.method === "PATCH") {
    const ctx = requireWorkspace(req, res, "member");
    if (!ctx) return;
    const raw = (req.body ?? {}).deal_size;
    const value = raw === null || raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1e9)) return res.status(400).json({ error: "Deal size must be a positive amount" });
    setDealSize(getDb(), ctx.workspaceId, value === null ? null : Math.round(value * 100) / 100);
    return res.json({ ok: true, deal_size: value });
  }
  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
