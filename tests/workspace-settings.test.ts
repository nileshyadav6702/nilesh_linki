import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import handler from "@/pages/api/settings/workspace";

const WS = "ws-prefs";

function call(method: string, body?: unknown) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  handler({ method, body, query: {}, headers: { "x-workspace-id": WS, "x-user-id": "wp-user", "x-workspace-role": "manager" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: { prefs: Record<string, boolean>; agents: number; error?: string } };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('wp-user', 'wp@example.com', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'wp-user', 'manager')").run(WS);
});

describe("workspace preferences", () => {
  it("defaults to on with no agents, then reflects and sets every agent", () => {
    expect(call("GET").body.prefs).toEqual({ auto_enrich_emails: true, exclude_first_degree: true });
    const db = getDb();
    db.prepare("INSERT INTO agents (id, workspace_id, name, enrich_emails, exclude_first_degree) VALUES ('wp-a1', ?, 'A', 1, 1), ('wp-a2', ?, 'B', 0, 1)").run(WS, WS);
    expect(call("GET").body.prefs.auto_enrich_emails).toBe(false);
    const res = call("PATCH", { auto_enrich_emails: true, exclude_first_degree: false });
    expect(res.body.prefs).toEqual({ auto_enrich_emails: true, exclude_first_degree: false });
    expect(db.prepare("SELECT SUM(enrich_emails) e, SUM(exclude_first_degree) x FROM agents WHERE workspace_id = ?").get(WS)).toEqual({ e: 2, x: 0 });
  });

  it("rejects non-boolean values", () => {
    expect(call("PATCH", { auto_enrich_emails: "yes" }).statusCode).toBe(400);
  });
});
