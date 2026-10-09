import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { activeJoinLink } from "@/lib/workspace-join-links";
import { listWorkspaceInvitations } from "@/lib/workspace-invitations";
import { invalidateMembershipCache, recordAudit, requireWorkspace, type WorkspaceRole } from "@/lib/workspace";

const ROLES: WorkspaceRole[] = ["owner", "admin", "manager", "member", "viewer"];
const RANK: Record<WorkspaceRole, number> = { owner: 0, admin: 1, manager: 2, member: 3, viewer: 4 };

// GET    /api/settings/members → workspace, members, pending invitations, the invite link (admins), your role
// PATCH  /api/settings/members { user_id, role } → change a member's role (admins; owner role by owners)
// DELETE /api/settings/members?user_id= → remove a member (never the last owner)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "admin");
  if (!ctx) return;
  const db = getDb();
  const ownerCount = () => (db.prepare("SELECT COUNT(*) n FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(ctx.workspaceId) as { n: number }).n;
  const roleOf = (userId: string) => (db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(ctx.workspaceId, userId) as { role: WorkspaceRole } | undefined)?.role;

  if (req.method === "GET") {
    const workspace = db.prepare("SELECT id, name FROM workspaces WHERE id = ?").get(ctx.workspaceId);
    const members = (db.prepare(`SELECT u.id, u.email, wm.role, wm.created_at joined_at,
        (SELECT COUNT(*) FROM agents a WHERE a.workspace_id = wm.workspace_id) agents
      FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ?`).all(ctx.workspaceId) as Array<{ id: string; email: string; role: WorkspaceRole; joined_at: string }>)
      .sort((a, b) => RANK[a.role] - RANK[b.role] || a.joined_at.localeCompare(b.joined_at))
      .map((m) => ({ ...m, you: m.id === ctx.userId }));
    const admin = RANK[ctx.role as WorkspaceRole] <= RANK.admin;
    const invitations = admin ? listWorkspaceInvitations(ctx.workspaceId).filter((i) => i.status === "pending") : [];
    const link = admin ? activeJoinLink(db, ctx.workspaceId) : null;
    return res.json({ workspace, members, invitations, link: link ? { ...link, token: undefined, path: `/join/${encodeURIComponent(link.token)}` } : null, role: ctx.role, can_manage: admin });
  }

  if (req.method === "PATCH") {
    const { user_id: userId, role } = (req.body ?? {}) as { user_id?: string; role?: WorkspaceRole };
    if (!userId || !role || !ROLES.includes(role)) return res.status(400).json({ error: "user_id and a valid role are required" });
    const current = roleOf(userId);
    if (!current) return res.status(404).json({ error: "Member not found" });
    if ((role === "owner" || current === "owner") && ctx.role !== "owner") return res.status(403).json({ error: "Only an owner can grant or change owner access" });
    if (current === "owner" && role !== "owner" && ownerCount() <= 1) return res.status(400).json({ error: "The workspace needs at least one owner" });
    db.prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, ctx.workspaceId, userId);
    invalidateMembershipCache(userId);
    recordAudit(ctx, "workspace.member_role_changed", "user", userId, { from: current, to: role });
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : "";
    const current = userId ? roleOf(userId) : undefined;
    if (!current) return res.status(404).json({ error: "Member not found" });
    if (current === "owner" && ctx.role !== "owner") return res.status(403).json({ error: "Only an owner can remove another owner" });
    if (current === "owner" && ownerCount() <= 1) return res.status(400).json({ error: "Cannot remove the last owner" });
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(ctx.workspaceId, userId);
    invalidateMembershipCache(userId);
    recordAudit(ctx, "workspace.member_removed", "user", userId);
    return res.status(204).end();
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return res.status(405).end();
}
