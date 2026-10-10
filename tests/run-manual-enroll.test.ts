import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import enrollHandler from "@/pages/api/runs/[id]/enroll";

const WS = "ws-manual-enroll";
const OTHER = "ws-manual-enroll-other";
const USER = "user-manual-enroll";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}

beforeAll(() => {
  const db = getDb();
  for (const ws of [WS, OTHER]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'me@x.io', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  for (const [wf, ws] of [["me-wf", WS], ["me-wf-o", OTHER]]) {
    db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, 'W', ?)").run(wf, ws);
    db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, 1, 'connect', 'linkedin')").run(`${wf}-s`, wf);
  }
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES ('me-run', ?, 'me-wf', 'completed')").run(WS);
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url) VALUES ('me-ok', ?, 'A', 'https://www.linkedin.com/in/me-ok'), ('me-noline', ?, 'B', NULL)").run(WS, WS);
});

describe("adding contacts to a run by hand", () => {
  it("reopens a completed run, and skips contacts with no channel to reach them", async () => {
    const res = mockRes();
    await enrollHandler({ method: "POST", query: { id: "me-run" }, body: { target_ids: ["me-ok", "me-noline"] }, headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" } } as unknown as NextApiRequest, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ skipped_unreachable: 1 });
    expect((getDb().prepare("SELECT status FROM runs WHERE id = 'me-run'").get() as { status: string }).status).toBe("running");
    expect(getDb().prepare("SELECT COUNT(*) n FROM run_profiles WHERE run_id = 'me-run'").get()).toEqual({ n: 1 });
  });
});
