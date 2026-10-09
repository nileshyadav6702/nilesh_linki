import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { billingSummary, setInvoiceEmail, usagePage } from "@/lib/credits/ledger";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const PAGE_SIZE = 10;
const putSchema = z.object({ invoice_email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address").max(254)]) });

// GET /api/settings/billing?page=1 → plan, credit balance, this cycle's usage and one page of the credit log
// PUT /api/settings/billing { invoice_email } (admin) → where invoice copies go ("" clears it)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT") { res.setHeader("Allow", ["GET", "PUT"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "admin");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "PUT") {
    const parsed = putSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Invalid email") });
    setInvoiceEmail(db, ctx.workspaceId, parsed.data.invoice_email || null);
    recordAudit(ctx, "billing.invoice_email", "workspace", ctx.workspaceId);
    return res.json({ ok: true });
  }
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(req.query.page ?? "1"), 10) || 1));
  const usage = usagePage(db, ctx.workspaceId, page, PAGE_SIZE);
  return res.json({ ...billingSummary(db, ctx.workspaceId), can_edit: ctx.role === "owner" || ctx.role === "admin", usage: { ...usage, page, page_size: PAGE_SIZE } });
}
