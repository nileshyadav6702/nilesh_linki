import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import handler from "@/pages/api/targets/[id]";

const WS = "ws-target-edit";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}
const patch = async (body: unknown) => {
  const res = mockRes();
  await handler({ method: "PATCH", query: { id: "te-t1" }, body, headers: { "x-workspace-id": WS, "x-user-id": "te-user", "x-workspace-role": "member" } } as unknown as NextApiRequest, res);
  return res;
};

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('te-user', 'te@example.com', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'te-user', 'member')").run(WS);
  db.prepare("INSERT INTO targets (id, workspace_id, first_name, last_name, full_name) VALUES ('te-t1', ?, 'Stu', 'Waters', 'Stu Waters')").run(WS);
});

describe("editing a contact from the lead drawer", () => {
  it("keeps the full name in step with first / last name", async () => {
    const res = await patch({ last_name: "Walters" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ first_name: "Stu", last_name: "Walters", full_name: "Stu Walters" });
  });

  it("saves title, company, email and phone; empty clears", async () => {
    const res = await patch({ title: "Head of Growth", company: "Coram AI", email: "stu@coram.ai", phone: "+1 555 123 4567" });
    expect(res.body).toMatchObject({ title: "Head of Growth", company: "Coram AI", email: "stu@coram.ai", phone: "+1 555 123 4567" });
    expect((await patch({ phone: "" })).body).toMatchObject({ phone: null });
  });

  it("rejects a bad email or phone, and an empty name", async () => {
    expect((await patch({ email: "not-an-email" })).statusCode).toBe(400);
    expect((await patch({ phone: "call me" })).statusCode).toBe(400);
    expect((await patch({ first_name: "", last_name: "" })).statusCode).toBe(400);
    expect((await patch({ title: 42 })).statusCode).toBe(400);
  });
});
