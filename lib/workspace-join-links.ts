import { createHash, randomBytes, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { invalidateMembershipCache } from "@/lib/workspace";

/**
 * Shareable invite link: anyone signed in with the link joins the workspace as a member,
 * up to MAX_USES times. Regenerating revokes the previous link. The token is kept encrypted
 * (so admins can copy the link again) and looked up by its hash.
 */

export const JOIN_LINK_MAX_USES = 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface JoinLinkView { token: string; uses: number; max_uses: number; created_at: string }

export function activeJoinLink(db: Database.Database, workspaceId: string): JoinLinkView | null {
  const row = db.prepare("SELECT token_enc, uses, max_uses, created_at FROM workspace_join_links WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(workspaceId) as { token_enc: string; uses: number; max_uses: number; created_at: string } | undefined;
  const token = row ? decryptSecret(row.token_enc) : null;
  return row && token ? { token, uses: row.uses, max_uses: row.max_uses, created_at: row.created_at } : null;
}

export function regenerateJoinLink(db: Database.Database, workspaceId: string, userId: string | null): JoinLinkView {
  const token = `kairo_join_${randomBytes(24).toString("base64url")}`;
  db.transaction(() => {
    db.prepare("UPDATE workspace_join_links SET revoked_at = datetime('now') WHERE workspace_id = ? AND revoked_at IS NULL").run(workspaceId);
    db.prepare("INSERT INTO workspace_join_links (id, workspace_id, token_hash, token_enc, max_uses, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), workspaceId, hash(token), encryptSecret(token), JOIN_LINK_MAX_USES, userId);
  })();
  return activeJoinLink(db, workspaceId)!;
}

export function revokeJoinLink(db: Database.Database, workspaceId: string) {
  db.prepare("UPDATE workspace_join_links SET revoked_at = datetime('now') WHERE workspace_id = ? AND revoked_at IS NULL").run(workspaceId);
}

export interface JoinLinkInfo { id: string; workspace_id: string; workspace_name: string; role: string; valid: boolean; reason: string | null }

export function lookupJoinLink(db: Database.Database, token: string): JoinLinkInfo | null {
  const row = db.prepare(`SELECT l.id, l.workspace_id, w.name workspace_name, l.role, l.uses, l.max_uses, l.revoked_at
    FROM workspace_join_links l JOIN workspaces w ON w.id = l.workspace_id WHERE l.token_hash = ?`).get(hash(token)) as
    { id: string; workspace_id: string; workspace_name: string; role: string; uses: number; max_uses: number; revoked_at: string | null } | undefined;
  if (!row) return null;
  const reason = row.revoked_at ? "This invite link was replaced by a newer one." : row.uses >= row.max_uses ? "This invite link has been used the maximum number of times." : null;
  return { id: row.id, workspace_id: row.workspace_id, workspace_name: row.workspace_name, role: row.role, valid: !reason, reason };
}

/** Adds the user to the link's workspace (no-op if already a member) and counts the use. */
export function acceptJoinLink(db: Database.Database, token: string, userId: string): JoinLinkInfo {
  const link = lookupJoinLink(db, token);
  if (!link) throw new Error("Invite link not found");
  if (!link.valid) throw new Error(link.reason ?? "Invite link is no longer valid");
  db.transaction(() => {
    const already = db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(link.workspace_id, userId);
    if (already) return;
    const used = db.prepare("UPDATE workspace_join_links SET uses = uses + 1 WHERE id = ? AND revoked_at IS NULL AND uses < max_uses").run(link.id);
    if (!used.changes) throw new Error("Invite link is no longer valid");
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(link.workspace_id, userId, link.role);
    db.prepare(`INSERT INTO audit_logs (id, workspace_id, user_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), link.workspace_id, userId, "workspace.join_link_used", "workspace_join_link", link.id, JSON.stringify({ role: link.role }));
  })();
  invalidateMembershipCache(userId);
  return link;
}
