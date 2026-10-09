import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { balance, grant } from "@/lib/credits/ledger";
import { requireSuperadmin } from "@/lib/superadmin";
import { firstIssue } from "@/lib/validation";

const schema = z.object({
  workspace_id: z.string().trim().min(1).max(100),
  credits: z.number().int().min(1, "Add at least 1 credit").max(100_000, "Add at most 100,000 credits at once"),
  note: z.string().trim().max(200).optional(),
});

// POST /api/admin/credits { workspace_id, credits, note? } → superadmin adds credits to a workspace
// (shown as "Credits added" in its usage log). Until payments are connected this is how credits are sold.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const admin = await requireSuperadmin(req, res);
  if (!admin) return;
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Invalid request") });
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(parsed.data.workspace_id)) return res.status(404).json({ error: "Workspace not found" });
  grant(db, parsed.data.workspace_id, parsed.data.credits, "admin_grant", parsed.data.note ?? `Added by ${admin}`);
  return res.json({ ok: true, balance: balance(db, parsed.data.workspace_id) });
}
