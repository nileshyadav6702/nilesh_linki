import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import keysApi from "@/pages/api/platform/api-keys";
import v1 from "@/pages/api/v1/[...path]";

const WS = "ws-api-keys-tab";
const USER = "u-api-keys-tab";

function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, req: { method: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }, role = "owner", user = USER) {
  let status = 200; let body: unknown;
  const res = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; }, setHeader() { return res; }, end() { return res; } } as unknown as NextApiResponse;
  const r = { query: {}, ...req, headers: { "x-workspace-id": WS, "x-user-id": user, "x-workspace-role": role, ...req.headers } } as unknown as NextApiRequest;
  return Promise.resolve(handler(r, res)).then(() => ({ status, body: body as Record<string, unknown> }));
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'keys@example.com', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(WS, USER);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u-api-keys-member', 'keys-member@example.com', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'u-api-keys-member', 'member')").run(WS);
});

describe("Settings → API keys", () => {
  it("validates the name", async () => {
    expect((await call(keysApi, { method: "POST", body: { name: "", scopes: ["contacts:read"] } })).status).toBe(400);
    expect((await call(keysApi, { method: "POST", body: { name: "x".repeat(81), scopes: ["contacts:read"] } })).status).toBe(400);
    expect((await call(keysApi, { method: "POST", body: { name: "Key", scopes: ["admin:all"] } })).status).toBe(400);
  });

  it("a read-only key reads but can't write, and a deleted key stops working", async () => {
    const created = await call(keysApi, { method: "POST", body: { name: "API Key #1234", scopes: ["contacts:read", "campaigns:read"] } });
    expect(created.status).toBe(201);
    const auth = { authorization: `Bearer ${created.body.key as string}` };
    expect((await call(v1, { method: "GET", query: { path: ["contacts"] }, headers: auth })).status).toBe(200);
    expect((await call(v1, { method: "POST", query: { path: ["contacts"] }, body: { full_name: "Ada" }, headers: auth })).status).toBe(403);
    const list = await call(keysApi, { method: "GET" });
    expect((list.body as unknown as Array<{ name: string; key_prefix: string }>)[0]).toMatchObject({ name: "API Key #1234" });
    expect(JSON.stringify(list.body)).not.toContain(created.body.key as string); // the secret is never listed
    expect((await call(keysApi, { method: "DELETE", query: { id: created.body.id } })).status).toBe(204);
    expect((await call(v1, { method: "GET", query: { path: ["contacts"] }, headers: auth })).status).toBe(401);
  });

  it("members can't create keys", async () => {
    expect((await call(keysApi, { method: "POST", body: { name: "Key", scopes: ["contacts:read"] } }, "member", "u-api-keys-member")).status).toBe(403);
  });
});
