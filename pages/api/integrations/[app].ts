import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { appByKey, type OptionKey } from "@/lib/integrations/catalog";
import { adapterFor } from "@/lib/integrations/adapters";
import { webhookList } from "@/lib/integrations/adapters/webhook";
import { deleteConnection, getConnection, isEnrichment, saveConnection, saveEnrichmentKey, type Options } from "@/lib/integrations/store";
import { enqueueAllLeads } from "@/lib/integrations/worker";
import { IntegrationError, type Config } from "@/lib/integrations/types";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const body = z.object({
  fields: z.record(z.string(), z.string().max(4000)).default({}),
  options: z.record(z.string(), z.boolean()).default({}),
  choice: z.object({ value: z.string().max(300), label: z.string().max(300) }).nullish(),
  webhooks: z.array(z.object({ url: z.string().trim().max(2000), trigger: z.enum(["lead", "reply"]) })).max(10).optional(),
});
const MASK = /^•+/;

// PUT    /api/integrations/:app { fields, options, choice?, webhooks? } → verify the credentials and connect
// POST   /api/integrations/:app?action=verify { fields } → check credentials only; returns campaigns/lists to pick from
// POST   /api/integrations/:app?action=sync → queue every qualified lead (and retry failed ones)
// DELETE /api/integrations/:app → disconnect
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["PUT", "POST", "DELETE"].includes(req.method ?? "")) { res.setHeader("Allow", ["PUT", "POST", "DELETE"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "admin");
  if (!ctx) return;
  const app = appByKey(String(req.query.app));
  if (!app || app.comingSoon) return res.status(404).json({ error: "Unknown integration" });
  const db = getDb();

  if (req.method === "DELETE") {
    if (isEnrichment(app.key)) saveEnrichmentKey(db, ctx.workspaceId, app.key, null);
    else deleteConnection(db, ctx.workspaceId, app.key);
    recordAudit(ctx, "integration.removed", "integration", app.key);
    return res.json({ ok: true });
  }
  if (req.method === "POST" && req.query.action === "sync") {
    if (!getConnection(db, ctx.workspaceId, app.key)) return res.status(404).json({ error: `${app.name} isn't connected` });
    return res.json({ queued: enqueueAllLeads(db, ctx.workspaceId, app.key) });
  }

  const parsed = body.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
  const existing = getConnection(db, ctx.workspaceId, app.key);
  // Masked secrets ("••••1234") mean "keep the saved one".
  const config: Config = { ...(existing?.config ?? {}) };
  for (const f of app.fields) {
    const v = parsed.data.fields[f.key]?.trim();
    if (v !== undefined && !MASK.test(v)) config[f.key] = v;
    if (!config[f.key] && f.default) config[f.key] = f.default;
    if (!config[f.key]) return res.status(400).json({ error: `${f.label} is required` });
  }
  if (app.key === "webhook") {
    const hooks = (parsed.data.webhooks ?? webhookList(config)).filter((h) => h.url);
    config.webhooks = JSON.stringify(hooks);
    if (parsed.data.fields.secret !== undefined && !MASK.test(parsed.data.fields.secret)) config.secret = parsed.data.fields.secret.trim() || undefined;
  }

  if (isEnrichment(app.key)) {
    if (req.method === "POST") return res.json({ ok: true });
    saveEnrichmentKey(db, ctx.workspaceId, app.key, config.api_key ?? null);
    recordAudit(ctx, "integration.configured", "integration", app.key);
    return res.json({ ok: true });
  }

  const adapter = adapterFor(app.key);
  if (!adapter) return res.status(501).json({ error: `${app.name} isn't available yet` });
  // OAuth apps are verified after the redirect, with real tokens.
  let account: string | undefined;
  let choices: Array<{ value: string; label: string }> = [];
  if (!app.oauth) {
    try {
      account = (await adapter.verify(config)).account;
      if (app.pick && adapter.choices) choices = await adapter.choices(config);
    } catch (err) {
      const message = err instanceof IntegrationError ? err.message : `Could not reach ${app.name}`;
      return res.status(400).json({ error: message });
    }
  }
  if (req.method === "POST") return res.json({ ok: true, account, choices });

  if (app.pick) {
    const choice = parsed.data.choice ?? (config.choice ? { value: config.choice, label: config.choice_label ?? config.choice } : null);
    if (!choice) return res.status(400).json({ error: `Choose a ${app.pick.label.toLowerCase()}`, choices });
    if (choices.length && !choices.some((c) => c.value === choice.value)) return res.status(400).json({ error: `That ${app.pick.label.toLowerCase()} no longer exists`, choices });
    config.choice = choice.value; config.choice_label = choice.label;
  }
  const options: Options = {};
  for (const o of app.options) options[o as OptionKey] = !!parsed.data.options[o];
  if (app.key === "webhook") options.auto_sync = !!parsed.data.options.auto_sync;
  const pendingOauth = app.oauth && !config.refresh_token;
  saveConnection(db, ctx.workspaceId, app.key, config, options, ctx.userId, pendingOauth ? "pending_oauth" : "connected");
  recordAudit(ctx, "integration.configured", "integration", app.key, { options });
  return res.json({ ok: true, account, oauth: pendingOauth ? `/api/integrations/oauth/${app.key}?step=start` : null });
}
