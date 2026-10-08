import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { currentMembershipRole, invalidateMembershipCache, requireWorkspace, workspaceFromRequest } from "@/lib/workspace";

const WS = "ws-sec-member-0001";
const USER = "user-sec-member-0001";

function req(headers: Record<string, string>) {
  return { headers } as unknown as NextApiRequest;
}

function res() {
  const out = { status: 200, body: undefined as unknown };
  const r = {
    status(code: number) { out.status = code; return r; },
    json(body: unknown) { out.body = body; return r; },
  } as unknown as NextApiResponse;
  return { r, out };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(USER, "member@sec.test", "x");
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Sec", "sec-member");
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
});

beforeEach(() => invalidateMembershipCache());

describe("per-request workspace membership", () => {
  it("defaults a missing role header to viewer, not owner", () => {
    expect(workspaceFromRequest(req({ "x-workspace-id": WS })).role).toBe("viewer");
    expect(workspaceFromRequest(req({ "x-workspace-id": WS, "x-workspace-role": "bogus" })).role).toBe("viewer");
  });

  it("uses the stored role over a stale header/JWT role", () => {
    const { r } = res();
    const ctx = requireWorkspace(req({ "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "owner" }), r, "viewer");
    expect(ctx?.role).toBe("admin");
  });

  it("rejects a user who is not a member of the workspace", () => {
    const { r, out } = res();
    expect(requireWorkspace(req({ "x-workspace-id": WS, "x-user-id": "stranger", "x-workspace-role": "owner" }), r)).toBeNull();
    expect(out.status).toBe(403);
  });

  it("caches for the TTL, then picks up removal and downgrade", () => {
    const db = getDb();
    const t0 = 1_000_000;
    expect(currentMembershipRole(USER, WS, t0)).toBe("admin");

    db.prepare("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ? AND workspace_id = ?").run(USER, WS);
    expect(currentMembershipRole(USER, WS, t0 + 30_000)).toBe("admin"); // still cached
    expect(currentMembershipRole(USER, WS, t0 + 61_000)).toBe("viewer"); // expired → reloaded

    db.prepare("DELETE FROM workspace_members WHERE user_id = ? AND workspace_id = ?").run(USER, WS);
    invalidateMembershipCache(USER);
    expect(currentMembershipRole(USER, WS)).toBeNull();

    const { r, out } = res();
    expect(requireWorkspace(req({ "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" }), r)).toBeNull();
    expect(out.status).toBe(403);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  });

  it("downgraded role is enforced against the route minimum", () => {
    const db = getDb();
    db.prepare("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ? AND workspace_id = ?").run(USER, WS);
    const { r, out } = res();
    expect(requireWorkspace(req({ "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" }), r, "admin")).toBeNull();
    expect(out.status).toBe(403);
    db.prepare("UPDATE workspace_members SET role = 'admin' WHERE user_id = ? AND workspace_id = ?").run(USER, WS);
  });
});
