import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { APPS, appByKey, type OptionKey } from "@/lib/integrations/catalog";
import type { Config, Lead } from "@/lib/integrations/types";

/** Integration connections (one per app per workspace) and what the Integrations page shows. */

type DB = Database.Database;
export type Options = Partial<Record<OptionKey, boolean>>;

export interface Connection { app: string; config: Config; options: Options; status: string; last_error: string | null; last_synced_at: string | null; created_at: string }

/** Enrichment keys keep living in `integrations`, which the email waterfall reads. */
const ENRICHMENT = new Set(APPS.filter((a) => a.category === "enrichment").map((a) => a.key));
export const isEnrichment = (app: string) => ENRICHMENT.has(app);

export function getConnection(db: DB, ws: string, app: string): Connection | null {
  const r = db.prepare("SELECT * FROM integration_connections WHERE workspace_id = ? AND app = ?").get(ws, app) as
    { app: string; config_enc: string; options_json: string; status: string; last_error: string | null; last_synced_at: string | null; created_at: string } | undefined;
  if (!r) return null;
  let config: Config = {};
  try { config = JSON.parse(decryptSecret(r.config_enc) ?? "{}"); } catch { config = {}; }
  let options: Options = {};
  try { options = JSON.parse(r.options_json); } catch { options = {}; }
  return { app: r.app, config, options, status: r.status, last_error: r.last_error, last_synced_at: r.last_synced_at, created_at: r.created_at };
}

export function saveConnection(db: DB, ws: string, app: string, config: Config, options: Options, userId: string | null, status = "connected"): void {
  db.prepare(`INSERT INTO integration_connections (workspace_id, app, config_enc, options_json, status, last_error, created_by)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(workspace_id, app) DO UPDATE SET config_enc = excluded.config_enc, options_json = excluded.options_json,
      status = excluded.status, last_error = NULL, updated_at = datetime('now')`)
    .run(ws, app, encryptSecret(JSON.stringify(config)), JSON.stringify(options), status, userId);
}

export function setStatus(db: DB, ws: string, app: string, status: string, error: string | null): void {
  db.prepare("UPDATE integration_connections SET status = ?, last_error = ?, updated_at = datetime('now') WHERE workspace_id = ? AND app = ?").run(status, error?.slice(0, 500) ?? null, ws, app);
}

export function deleteConnection(db: DB, ws: string, app: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM integration_connections WHERE workspace_id = ? AND app = ?").run(ws, app);
    db.prepare("DELETE FROM integration_syncs WHERE workspace_id = ? AND app = ? AND status = 'pending'").run(ws, app);
  })();
}

export function enrichmentKey(db: DB, ws: string, app: string): string | null {
  const r = db.prepare("SELECT api_key FROM integrations WHERE workspace_id = ? AND key = ?").get(ws, app) as { api_key: string | null } | undefined;
  return decryptSecret(r?.api_key ?? null);
}

export function saveEnrichmentKey(db: DB, ws: string, app: string, key: string | null): void {
  if (!key) { db.prepare("DELETE FROM integrations WHERE workspace_id = ? AND key = ?").run(ws, app); return; }
  db.prepare(`INSERT INTO integrations (workspace_id, key, api_key, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, key) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at`).run(ws, app, encryptSecret(key));
}

const mask = (v: string | undefined) => (v ? `••••••••${v.slice(-4)}` : "");

export interface AppState {
  app: string; installed: boolean; status: string | null; last_error: string | null; last_synced_at: string | null;
  options: Options; fields: Record<string, string>; choice_label: string | null;
  stats: { synced: number; pending: number; failed: number };
}

/** Everything the page needs per app. Secrets come back masked; plain fields as they are. */
export function appStates(db: DB, ws: string): AppState[] {
  const stats = db.prepare(`SELECT app, SUM(status = 'done') synced, SUM(status = 'pending') pending, SUM(status = 'failed') failed
    FROM integration_syncs WHERE workspace_id = ? GROUP BY app`).all(ws) as Array<{ app: string; synced: number; pending: number; failed: number }>;
  return APPS.filter((a) => !a.comingSoon).map((a) => {
    const s = stats.find((x) => x.app === a.key);
    const base = { app: a.key, stats: { synced: s?.synced ?? 0, pending: s?.pending ?? 0, failed: s?.failed ?? 0 } };
    if (isEnrichment(a.key)) {
      const k = enrichmentKey(db, ws, a.key);
      return { ...base, installed: !!k, status: k ? "connected" : null, last_error: null, last_synced_at: null, options: {}, fields: { api_key: mask(k ?? undefined) }, choice_label: null };
    }
    const c = getConnection(db, ws, a.key);
    const def = appByKey(a.key)!;
    const fields: Record<string, string> = {};
    for (const f of def.fields) fields[f.key] = f.type === "secret" ? mask(c?.config[f.key]) : c?.config[f.key] ?? "";
    if (a.key === "webhook") { fields.webhooks = c?.config.webhooks ?? "[]"; fields.secret = mask(c?.config.secret); }
    return { ...base, installed: !!c, status: c?.status ?? null, last_error: c?.last_error ?? null, last_synced_at: c?.last_synced_at ?? null,
      options: c?.options ?? {}, fields, choice_label: c?.config.choice_label ?? null };
  });
}

/** The lead as adapters see it. */
export function leadFor(db: DB, targetId: string): Lead | null {
  const r = db.prepare(`SELECT t.id, t.first_name, t.last_name, t.full_name, t.email, t.title, t.headline, t.company, t.linkedin_url, t.phone,
      t.location, t.lead_score, c.domain, c.website, a.name AS agent
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = ?`).get(targetId) as
    (Omit<Lead, "company_domain" | "agent"> & { domain: string | null; website: string | null; agent: string | null }) | undefined;
  if (!r) return null;
  const domain = (r.domain || r.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  return { id: r.id, first_name: r.first_name, last_name: r.last_name, full_name: r.full_name, email: r.email, title: r.title, headline: r.headline,
    company: r.company, company_domain: domain, linkedin_url: r.linkedin_url, phone: r.phone, location: r.location, lead_score: r.lead_score, agent: r.agent };
}
