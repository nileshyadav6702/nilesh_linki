import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { startHeadlessLogin, submitLoginChallenge, awaitLoginApproval } from "@/lib/linkedin/session";
import { requireWorkspace, requireWorkspaceEntity } from "@/lib/workspace";
import { AccountBusyError, withAccountSession } from "@/lib/linkedin/account-session";

/**
 * Server-side headless LinkedIn login.
 *   POST { step: "start", email, password }  → begins login (returns authenticated | challenge | error)
 *   POST { step: "verify", code }            → submits the email/SMS verification code
 *   POST { step: "await" }                   → waits for a device/app approval to clear
 *
 * The session is born under the same pinned Chromium fingerprint the runner uses
 * and captures all cookies (incl. httpOnly li_ep_auth_context).
 *
 * Each step holds the account (in this process and across the web/worker split) while it
 * talks to LinkedIn, and answers 409 while a runner unit is using the account. Between steps
 * (while LinkedIn waits for a code or an app approval) the account is not held.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const ctx = requireWorkspace(req, res, "admin"); if (!ctx) return;

  const db = getDb();
  const id = req.query.id as string;
  if (!requireWorkspaceEntity(res, ctx, "accounts", id)) return;
  const account = db.prepare("SELECT * FROM accounts WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId) as
    | { email: string }
    | undefined;
  if (!account) return res.status(404).json({ error: "Account not found" });

  const { step } = req.body as { step?: string };

  try {
    if (step === "verify") {
      const { code } = req.body as { code?: string };
      if (!code?.trim()) return res.status(400).json({ error: "code is required" });
      return res.json(await withAccountSession(id, () => submitLoginChallenge(id, code.trim())));
    }

    if (step === "await") {
      return res.json(await withAccountSession(id, () => awaitLoginApproval(id)));
    }

    const { email, password } = req.body as { email?: string; password?: string };
    const loginEmail = (email || account.email || "").trim();
    if (!loginEmail || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    return res.json(await withAccountSession(id, () => startHeadlessLogin(id, loginEmail, password)));
  } catch (e) {
    if (e instanceof AccountBusyError) return res.status(409).json({ error: e.message });
    return res.status(500).json({ error: (e as Error).message });
  }
}
