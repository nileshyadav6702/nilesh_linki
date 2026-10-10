import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";
import { addSuppression } from "@/lib/platform/suppression";
import { emitDomainEvent } from "@/lib/platform/events";

/**
 * One-click unsubscribe (RFC 2369 List-Unsubscribe + RFC 8058 List-Unsubscribe-Post).
 *
 * The token is an HMAC over (workspace, address), so a link can only ever suppress the
 * address it was minted for, in the workspace that sent it: changing either part breaks
 * the signature. It carries no job id, so every email to the same contact shares one
 * stable link, and it keeps working after retention prunes the send.
 *
 * Campaign copy is unchanged by default: the headers are always added, but a visible
 * footer link only appears where a template uses {{unsubscribe_url}}.
 */

export const UNSUBSCRIBE_TOKEN_VARIABLE = "unsubscribe_url";

function secret(): string | null {
  return process.env.EMAIL_TRACKING_SECRET || process.env.NEXTAUTH_SECRET || null;
}

/**
 * Keys a link may have been signed with: the current one, then any retired ones listed in
 * EMAIL_TRACKING_SECRET_PREVIOUS (comma-separated). Links already in inboxes must keep working
 * after a secret rotation, or people can't unsubscribe and complain instead.
 */
function verificationKeys(): string[] {
  const previous = (process.env.EMAIL_TRACKING_SECRET_PREVIOUS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  return [secret(), ...previous, process.env.NEXTAUTH_SECRET].filter((k, i, all): k is string => !!k && all.indexOf(k) === i);
}

function baseUrl(): string | null {
  const value = (process.env.EMAIL_TRACKING_BASE_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  return /^https?:\/\//i.test(value) ? value : null;
}

function sign(workspaceId: string, email: string, key: string): string {
  return createHmac("sha256", key).update(`unsubscribe:${workspaceId}:${email}`).digest("base64url");
}

export function createUnsubscribeToken(workspaceId: string, email: string): string | null {
  const key = secret();
  if (!key) return null;
  const normalized = email.trim().toLowerCase();
  const payload = Buffer.from(JSON.stringify([workspaceId, normalized])).toString("base64url");
  return `${payload}.${sign(workspaceId, normalized, key)}`;
}

/** The (workspace, address) a token was minted for, or null if it is malformed or forged. */
export function verifyUnsubscribeToken(token: string): { workspaceId: string; email: string } | null {
  const keys = verificationKeys();
  if (!keys.length || token.length > 1024) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8")); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
  const [workspaceId, email] = parsed as [string, string];
  if (!workspaceId || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  const supplied = Buffer.from(token.slice(dot + 1));
  for (const key of keys) {
    const expected = Buffer.from(sign(workspaceId, email, key));
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return { workspaceId, email };
  }
  return null;
}

export function unsubscribeUrl(workspaceId: string, email: string): string | null {
  const base = baseUrl();
  const token = createUnsubscribeToken(workspaceId, email);
  return base && token ? `${base}/api/u/${token}` : null;
}

/**
 * List-Unsubscribe headers for one recipient. One-click POST needs an https URL (RFC 8058);
 * the mailto fallback goes to the mailbox's reply address, where the reply classifier
 * already turns an explicit opt-out into a suppression.
 */
export function unsubscribeHeaders(workspaceId: string, email: string, mailbox?: string | null): Record<string, string> {
  const url = unsubscribeUrl(workspaceId, email);
  const httpsUrl = url && url.startsWith("https://") ? url : null;
  const mailto = mailbox && /^[^\s@<>]+@[^\s@<>]+$/.test(mailbox) ? `mailto:${mailbox}?subject=unsubscribe` : null;
  const entries = [httpsUrl, mailto].filter((v): v is string => Boolean(v)).map((v) => `<${v}>`);
  if (entries.length === 0) return {};
  return {
    "List-Unsubscribe": entries.join(", "),
    ...(httpsUrl ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
  };
}

/** Replace {{unsubscribe_url}} in a template. A link that cannot be built renders empty. */
export function applyUnsubscribeVariable(text: string, workspaceId: string, email: string): string {
  if (!/\{\{\s*unsubscribe_url\s*(\|[^}]*)?\}\}/i.test(text)) return text;
  const url = unsubscribeUrl(workspaceId, email) ?? "";
  return text.replace(/\{\{\s*unsubscribe_url\s*(\|[^}]*)?\}\}/gi, url);
}

/**
 * Suppress the address in that workspace, stop every open track for contacts with that
 * address, and cancel campaign mail still queued to it. Idempotent.
 */
export function unsubscribeAddress(workspaceId: string, email: string, source = "list_unsubscribe"): { tracksStopped: number; jobsCancelled: number } {
  const db = getDb();
  const address = email.trim().toLowerCase();
  const exists = db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(workspaceId);
  if (!exists) return { tracksStopped: 0, jobsCancelled: 0 };
  return db.transaction(() => {
    const target = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND lower(email) = ? LIMIT 1").get(workspaceId, address) as { id: string } | undefined;
    addSuppression({ workspaceId, kind: "email", value: address, reason: "unsubscribe", source, targetId: target?.id });
    const tracksStopped = db.prepare(`UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Unsubscribed'
      WHERE state NOT IN ('completed','failed','skipped') AND run_profile_id IN (
        SELECT rp.id FROM run_profiles rp JOIN targets t ON t.id = rp.target_id WHERE t.workspace_id = ? AND lower(t.email) = ?)`)
      .run(workspaceId, address).changes;
    const jobsCancelled = db.prepare(`UPDATE email_jobs SET status = 'cancelled', last_error = 'Recipient unsubscribed', updated_at = datetime('now')
      WHERE workspace_id = ? AND lower(recipient) = ? AND status = 'pending' AND source = 'campaign'`).run(workspaceId, address).changes;
    emitDomainEvent({ workspaceId, type: "email.unsubscribed", entityType: target ? "contact" : "email", entityId: target?.id ?? address, payload: { email: address, source } });
    return { tracksStopped, jobsCancelled };
  })();
}
