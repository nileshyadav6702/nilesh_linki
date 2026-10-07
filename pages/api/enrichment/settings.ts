import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { PROVIDERS, providerOrder, setProviderOrder } from "@/lib/enrichment/waterfall";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

// GET /api/enrichment/settings → providers in waterfall order with configured flags
// PUT /api/enrichment/settings { order: string[] }
// Provider API keys are stored through /api/integrations (keys: apollo, hunter, prospeo, findymail, ipinfo).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "admin");
  if (!ctx) return;
  const db = getDb();
  if (req.method === "GET") {
    const configured = new Set((db.prepare("SELECT key FROM integrations WHERE workspace_id = ? AND api_key IS NOT NULL").all(ctx.workspaceId) as Array<{ key: string }>).map((r) => r.key));
    const order = providerOrder(db, ctx.workspaceId);
    const ordered = [...order, ...PROVIDERS.map((p) => p.key).filter((k) => !order.includes(k))];
    return res.json({
      providers: ordered.map((key) => {
        const p = PROVIDERS.find((x) => x.key === key)!;
        return { key, label: p.label, needs_key: p.needsKey, configured: !p.needsKey || configured.has(key), enabled: order.includes(key) };
      }),
      ipinfo_configured: configured.has("ipinfo"),
    });
  }
  if (req.method === "PUT") {
    const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).filter((x): x is string => typeof x === "string") : null;
    if (!order) return res.status(400).json({ error: "order must be an array of provider keys" });
    setProviderOrder(db, ctx.workspaceId, order);
    recordAudit(ctx, "enrichment.order_updated", "workspace", ctx.workspaceId, { order });
    return res.json({ ok: true });
  }
  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end();
}
