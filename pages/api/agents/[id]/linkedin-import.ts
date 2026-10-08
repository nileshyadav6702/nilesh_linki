import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getAgent } from "@/lib/agents/store";
import { LeadSourceError } from "@/lib/agents/lead-sources";
import { connectedAccount, countEngagers, importPostEngagers, importSingleProfile, postUrn, startSalesNavImport } from "@/lib/agents/lead-imports";
import { fetchPostEngagersWithAccount } from "@/lib/agents/post-engagers";
import { AccountBusyError } from "@/lib/linkedin/account-session";
import { discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const id = z.string().trim().min(1).max(100);
const url = z.string().trim().min(10).max(1000);
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sales_nav"), url, count: z.number().int().min(1, "Choose between 1 and 2000 leads").max(2000, "Choose between 1 and 2000 leads"), account_id: id, list_id: id }),
  z.object({ kind: z.literal("post_preview"), post_url: url, account_id: id }),
  z.object({ kind: z.literal("post"), post_url: url, account_id: id, list_id: id, reactions: z.boolean().default(true), comments: z.boolean().default(false) }),
  z.object({ kind: z.literal("profile"), profile_url: url, list_id: id }),
]);

// POST /api/agents/:id/linkedin-import — "Import from LinkedIn" in the Lead sources drawer.
//   sales_nav     { url, count, account_id, list_id }  → paced Sales Navigator import, capped at count
//   post_preview  { post_url, account_id }              → engager counts of a post (reads LinkedIn)
//   post          { post_url, account_id, list_id }     → reactors → contacts in the list
//   profile       { profile_url, list_id }              → one contact in the list
// Every kind attaches the list to the agent. LinkedIn work holds the account lease (busy → 409).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const db = getDb();
  const agent = getAgent(String(req.query.id), ctx.workspaceId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Invalid import") });
  const body = parsed.data;

  try {
    if (body.kind === "sales_nav") {
      const r = startSalesNavImport(db, agent, body);
      recordAudit(ctx, "agent.linkedin_import", "agent", agent.id, { kind: body.kind, list_id: r.list_id, count: body.count });
      return res.status(202).json(r);
    }
    if (body.kind === "profile") {
      const r = importSingleProfile(db, agent, body);
      recordAudit(ctx, "agent.linkedin_import", "agent", agent.id, { kind: body.kind, list_id: r.list_id });
      return res.json(r);
    }

    // Post engagers: validate everything before touching LinkedIn.
    const urn = postUrn(body.post_url);
    const account = connectedAccount(db, ctx.workspaceId, body.account_id);
    if (body.kind === "post") {
      if (!body.reactions) return res.status(400).json({ error: "Choose at least one audience to import" });
      if (!db.prepare("SELECT 1 FROM lists WHERE id = ? AND workspace_id = ?").get(body.list_id, ctx.workspaceId)) return res.status(404).json({ error: "List not found" });
    }
    const paused = discoveryPausedUntil(account.id);
    if (paused) return res.status(409).json({ error: `LinkedIn is limiting this account until ${paused.until}. Try again later.` });
    const engagers = await fetchPostEngagersWithAccount(account.id, urn);
    if (body.kind === "post_preview") return res.json({ activity_urn: urn, ...countEngagers(engagers) });
    const r = importPostEngagers(db, agent, body.list_id, engagers.filter((e) => e.kind === "reaction"));
    recordAudit(ctx, "agent.linkedin_import", "agent", agent.id, { kind: body.kind, list_id: r.list_id, imported: r.imported });
    return res.json(r);
  } catch (err) {
    if (err instanceof LeadSourceError) return res.status(err.status).json({ error: err.message });
    if (err instanceof AccountBusyError) return res.status(409).json({ error: err.message });
    if (err instanceof Error && err.name === "VoyagerBlockedError") {
      const status = (err as Error & { status?: number }).status;
      if ((status === 429 || status === 999) && "account_id" in body) pauseDiscovery(body.account_id, err.message);
      return res.status(502).json({ error: status === 401 || status === 403 ? "LinkedIn needs you to connect this account again." : "LinkedIn is limiting this account right now. Try again later." });
    }
    if (err instanceof Error && err.name === "VoyagerBudgetExceeded") return res.status(429).json({ error: err.message });
    throw err;
  }
}
