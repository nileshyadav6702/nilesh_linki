import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, recordAudit } from "@/lib/workspace";
import { encryptSecret } from "@/lib/crypto";
import { linkedinActionsToday } from "@/lib/linkedin/actions";
import { normalizeProxyUrl } from "@/lib/linkedin/proxy";

// Excludes cookies_json — the frontend never uses the raw session blob, only
// is_authenticated, so there's no reason to ship it (even encrypted) to the client.
const ACCOUNT_COLUMNS = `id, name, email, is_authenticated, daily_connection_limit, daily_message_limit, daily_inmail_limit, daily_visit_limit,
  active_hours_start, active_hours_end, timezone, working_days, created_at,
  inbox_synced_at, accepted_sync_at, li_connections, li_pending, li_profile_views,
  li_stats_synced_at, connections_synced_through_ms, proxy_url, proxy_username, (proxy_password IS NOT NULL AND proxy_password <> '') AS has_proxy_password`;

/** The account as the settings drawer sees it, with today's action counts on the account's own day. */
function accountView(db: ReturnType<typeof getDb>, id: string, workspaceId: string) {
  const account = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as Record<string, unknown> | undefined;
  if (!account) return null;
  const tz = String(account.timezone || "UTC");
  const today = (t: "visit" | "connect" | "message" | "inmail" | "like" | "voice") => linkedinActionsToday(db, id, t, tz);
  return { ...account, has_proxy_password: !!account.has_proxy_password, usage_today: { visit: today("visit") + today("like"), connect: today("connect"), message: today("message") + today("voice"), inmail: today("inmail") } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "admin");
  if (!ctx) return;

  if (req.method === "GET") {
    const account = accountView(db, id, ctx.workspaceId);
    if (!account) return res.status(404).json({ error: "Not found" });
    return res.json(account);
  }

  if (req.method === "PUT") {
    const { name, email, daily_connection_limit, daily_message_limit, daily_inmail_limit, active_hours_start, active_hours_end, timezone, working_days } = req.body;
    // Hard ceiling regardless of client input — unbounded profile visiting reads as
    // scraping to LinkedIn's abuse detection, so this cap isn't user-configurable upward.
    const daily_visit_limit = req.body.daily_visit_limit != null ? Math.min(150, Number(req.body.daily_visit_limit)) : null;
    db.prepare(
      `UPDATE accounts SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        daily_connection_limit = COALESCE(?, daily_connection_limit),
        daily_message_limit = COALESCE(?, daily_message_limit),
        daily_inmail_limit = COALESCE(?, daily_inmail_limit),
        daily_visit_limit = COALESCE(?, daily_visit_limit),
        active_hours_start = COALESCE(?, active_hours_start),
        active_hours_end = COALESCE(?, active_hours_end),
        timezone = COALESCE(?, timezone),
        working_days = COALESCE(?, working_days)
       WHERE id = ? AND workspace_id = ?`
    ).run(name, email, daily_connection_limit, daily_message_limit, daily_inmail_limit, daily_visit_limit, active_hours_start, active_hours_end, timezone, working_days, id, ctx.workspaceId);
    // Proxy override: "" clears it; the password is kept unless a new one (or "") is sent.
    const body = req.body as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(body, "proxy_url")) {
      const raw = typeof body.proxy_url === "string" ? body.proxy_url.trim() : "";
      const url = raw ? normalizeProxyUrl(raw) : null;
      if (raw && !url) return res.status(400).json({ error: "Proxy must look like http://host:port (or https/socks5)" });
      db.prepare("UPDATE accounts SET proxy_url = ?, proxy_username = ? WHERE id = ? AND workspace_id = ?")
        .run(url, url && typeof body.proxy_username === "string" && body.proxy_username.trim() ? body.proxy_username.trim() : null, id, ctx.workspaceId);
      if (!url) db.prepare("UPDATE accounts SET proxy_password = NULL WHERE id = ? AND workspace_id = ?").run(id, ctx.workspaceId);
      // An open browser context keeps its old proxy; close it so the next use picks up the new one.
      const { closeSession } = await import("@/lib/linkedin/session");
      await closeSession(id).catch(() => {});
    }
    if (typeof body.proxy_password === "string") {
      db.prepare("UPDATE accounts SET proxy_password = ? WHERE id = ? AND workspace_id = ?").run(body.proxy_password ? encryptSecret(body.proxy_password) : null, id, ctx.workspaceId);
    }
    recordAudit(ctx, "account.updated", "account", id);
    return res.json(accountView(db, id, ctx.workspaceId));
  }

  if (req.method === "DELETE") {
    const account = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND workspace_id = ?")
      .get(id, ctx.workspaceId) as { id: string } | undefined;
    if (!account) return res.status(404).json({ error: "Not found" });

    // Refuse while campaigns are live. Deleting the account takes its runs with it, and
    // silently ending someone's outreach is not a side effect a delete button should have —
    // the user pauses them first, deliberately.
    const blocking = db
      .prepare(
        `SELECT r.id, w.name FROM runs r
         LEFT JOIN workflows w ON w.id = r.workflow_id
         WHERE r.account_id = ? AND r.status IN ('running', 'pending')`
      )
      .all(id) as Array<{ id: string; name: string | null }>;
    if (blocking.length > 0) {
      return res.status(409).json({
        error: "Account is in use by active campaigns",
        message: `Pause or stop ${blocking.length} active campaign${blocking.length === 1 ? "" : "s"} before deleting this account.`,
        campaigns: blocking.map((r) => ({ run_id: r.id, name: r.name ?? "Untitled campaign" })),
      });
    }

    // Drop the live browser context before the row goes away, so a cached session can't
    // outlive the account it belongs to.
    const { closeSession } = await import("@/lib/linkedin/session");
    try { await closeSession(id); } catch { /* best effort — the row is going regardless */ }

    // runs.account_id is a plain REFERENCES with no ON DELETE action and foreign_keys is ON,
    // so the account cannot be removed while any run still points at it — this used to fail
    // outright for every account that had ever run a campaign. Historical runs are deleted
    // rather than detached: the runner reaches runs through `JOIN accounts`, so a detached
    // run would be invisible forever instead of merely finished. Everything below a run
    // (run_profiles -> run_profile_tracks, logs) cascades; email_replies, email_jobs and
    // sent_messages null their run_id and keep their own history.
    db.transaction(() => {
      db.prepare("DELETE FROM runs WHERE account_id = ?").run(id);
      db.prepare("DELETE FROM accounts WHERE id = ? AND workspace_id = ?").run(id, ctx.workspaceId);
    })();

    recordAudit(ctx, "account.deleted", "account", id);
    return res.status(204).end();
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  res.status(405).end();
}
