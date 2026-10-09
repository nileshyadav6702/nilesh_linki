import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { oauthAdapterFor } from "@/lib/integrations/adapters";
import { getConnection, saveConnection, setStatus } from "@/lib/integrations/store";
import { IntegrationError } from "@/lib/integrations/types";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const STATE_TTL_MS = 10 * 60_000;

/** The callback URL to register in the provider's app (same for start and callback). */
function oauthRedirect(req: NextApiRequest, app: string): string {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
  return `${base}/api/integrations/oauth/${app}`;
}

const back = (res: NextApiResponse, app: string, error?: string) =>
  res.redirect(302, `/integrations?${error ? `error=${encodeURIComponent(error)}&app=${app}` : `connected=${app}`}`);

// GET /api/integrations/oauth/:app?step=start → redirect to the provider's consent screen
// GET /api/integrations/oauth/:app?code=…&state=… → provider callback: exchange the code, verify, connect
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "admin");
  if (!ctx) return;
  const app = String(req.query.app);
  const adapter = oauthAdapterFor(app);
  if (!adapter) return res.status(404).json({ error: "Unknown integration" });
  const db = getDb();
  const conn = getConnection(db, ctx.workspaceId, app);
  if (!conn) return back(res, app, "Save the app's credentials first");
  const redirectUri = oauthRedirect(req, app);

  if (req.query.step === "start") {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'oauth_state:%' AND updated_at < datetime('now', '-1 hour')").run();
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .run(`oauth_state:${state}`, JSON.stringify({ ws: ctx.workspaceId, app, verifier, exp: Date.now() + STATE_TTL_MS }));
    try { return res.redirect(302, adapter.authorizeUrl(conn.config, redirectUri, state, challenge)); }
    catch (err) { return back(res, app, err instanceof Error ? err.message : "Could not start sign-in"); }
  }

  // Callback
  const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v)]));
  if (q.error) return back(res, app, q.error_description || q.error);
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`oauth_state:${q.state ?? ""}`) as { value: string } | undefined;
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(`oauth_state:${q.state ?? ""}`);
  const saved = row ? JSON.parse(row.value) as { ws: string; app: string; verifier: string; exp: number } : null;
  if (!saved || saved.ws !== ctx.workspaceId || saved.app !== app || saved.exp < Date.now() || !q.code) return back(res, app, "The sign-in link expired. Try connecting again.");
  try {
    const tokens = await adapter.exchange(conn.config, q.code, redirectUri, saved.verifier, q);
    const config = { ...conn.config, ...tokens };
    const { account } = await adapter.verify(config);
    saveConnection(db, ctx.workspaceId, app, config, conn.options, ctx.userId, "connected");
    recordAudit(ctx, "integration.connected", "integration", app, { account: account ?? null });
    return back(res, app);
  } catch (err) {
    const message = err instanceof IntegrationError || err instanceof Error ? err.message : "Sign-in failed";
    setStatus(db, ctx.workspaceId, app, "error", message);
    return back(res, app, message);
  }
}
