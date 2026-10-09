import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { acceptJoinLink, activeJoinLink, lookupJoinLink, regenerateJoinLink } from "@/lib/workspace-join-links";
import { companyAlreadyInOutreach } from "@/lib/workspace-prefs";
import handler from "@/pages/api/settings/members";

const WS = "ws-members";
// The stored link token is encrypted with the app secret.
process.env.NEXTAUTH_SECRET ||= "test-secret-for-members-tests-0123456789";

function call(method: string, as: string, body?: unknown, query: Record<string, string> = {}) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  handler({ method, body, query, headers: { "x-workspace-id": WS, "x-user-id": as, "x-workspace-role": "owner" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: Record<string, unknown> };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, 'Acme', ?)").run(WS, WS);
  for (const [id, role] of [["m-owner", "owner"], ["m-admin", "admin"]]) {
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(id, `${id}@acme.test`);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(WS, id, role);
  }
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('m-new', 'new@acme.test', 'x')").run();
});

describe("invite link", () => {
  it("joins as member once per user, counts uses, and dies when regenerated", () => {
    const db = getDb();
    const first = regenerateJoinLink(db, WS, "m-owner");
    expect(activeJoinLink(db, WS)).toMatchObject({ token: first.token, uses: 0, max_uses: 30 });
    acceptJoinLink(db, first.token, "m-new");
    acceptJoinLink(db, first.token, "m-new"); // already a member: not counted again
    expect(activeJoinLink(db, WS)?.uses).toBe(1);
    expect(db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = 'm-new'").get(WS)).toEqual({ role: "member" });
    const second = regenerateJoinLink(db, WS, "m-owner");
    expect(lookupJoinLink(db, first.token)).toMatchObject({ valid: false });
    expect(lookupJoinLink(db, second.token)).toMatchObject({ valid: true, workspace_name: "Acme" });
    expect(lookupJoinLink(db, "kairo_join_nope")).toBeNull();
  });
});

describe("members API", () => {
  it("lists members (owners first) with the invite link path", () => {
    const res = call("GET", "m-owner");
    const members = res.body.members as Array<{ id: string; role: string; you: boolean }>;
    expect(members[0]).toMatchObject({ id: "m-owner", role: "owner", you: true });
    expect(String((res.body.link as { path: string }).path)).toMatch(/^\/join\/kairo_join_/);
  });

  it("changes roles but never leaves the workspace without an owner", () => {
    expect(call("PATCH", "m-owner", { user_id: "m-new", role: "viewer" }).statusCode).toBe(200);
    expect(call("PATCH", "m-owner", { user_id: "m-owner", role: "admin" }).statusCode).toBe(400);
    expect(call("DELETE", "m-owner", undefined, { user_id: "m-owner" }).statusCode).toBe(400);
    expect(call("DELETE", "m-owner", undefined, { user_id: "m-new" }).statusCode).toBe(204);
  });
});

describe("company dedup", () => {
  it("spots another lead from the same company already in outreach", () => {
    const db = getDb();
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, company, agent_status) VALUES ('cd-1', ?, 'A', 'Coram AI', 'enrolled'), ('cd-2', ?, 'B', 'coram ai ', 'qualified'), ('cd-3', ?, 'C', 'Other', 'qualified')").run(WS, WS, WS);
    expect(companyAlreadyInOutreach(db, WS, { id: "cd-2", company: "coram ai ", company_id: null })).toBe(true);
    expect(companyAlreadyInOutreach(db, WS, { id: "cd-3", company: "Other", company_id: null })).toBe(false);
  });
});
