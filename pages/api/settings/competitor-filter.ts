import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { allowCompany, filteredCompanies, filterEnabled, prorated, setCompetitorFilter } from "@/lib/blocklist/competitors";
import { balance, InsufficientCreditsError, seats } from "@/lib/credits/ledger";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const putSchema = z.object({ enabled: z.boolean() });
const postSchema = z.object({ allow: z.string().min(1).max(300) });

// GET  /api/settings/competitor-filter?q=  → on/off, price now (prorated) and per month, balance, filtered companies
// PUT  /api/settings/competitor-filter { enabled } (admin) → switching on charges the prorated price (402 when short)
// POST /api/settings/competitor-filter { allow: company_key } → "not a competitor": allow it from now on
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "PUT", "POST"].includes(req.method ?? "")) { res.setHeader("Allow", ["GET", "PUT", "POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : req.method === "PUT" ? "admin" : "member");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "PUT") {
    const parsed = putSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "enabled must be true or false" });
    try {
      const charged = setCompetitorFilter(db, ctx.workspaceId, parsed.data.enabled, ctx.userId);
      recordAudit(ctx, parsed.data.enabled ? "competitor_filter.on" : "competitor_filter.off", "workspace", ctx.workspaceId, { charged });
      return res.json({ enabled: parsed.data.enabled, charged });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) return res.status(402).json({ error: err.message, code: "insufficient_credits" });
      throw err;
    }
  }
  if (req.method === "POST") {
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose a company" });
    if (!allowCompany(db, ctx.workspaceId, parsed.data.allow)) return res.status(404).json({ error: "Company not found" });
    recordAudit(ctx, "competitor_filter.allowed", "workspace", ctx.workspaceId, { company: parsed.data.allow });
    return res.json({ ok: true });
  }
  return res.json({
    enabled: filterEnabled(db, ctx.workspaceId), price: prorated(db, ctx.workspaceId), seats: seats(db, ctx.workspaceId),
    balance: Math.max(0, balance(db, ctx.workspaceId)), can_edit: ctx.role === "owner" || ctx.role === "admin",
    filtered: filteredCompanies(db, ctx.workspaceId, String(req.query.q ?? "").slice(0, 200)),
  });
}
