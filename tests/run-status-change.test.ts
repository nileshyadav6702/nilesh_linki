import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import runHandler from "@/pages/api/runs/[id]/index";

const WS = "ws-run-status";
const USER = "user-run-status";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}
async function patch(id: string, status: unknown) {
  const res = mockRes();
  await runHandler({ method: "PATCH", query: { id }, body: { status }, headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" } } as unknown as NextApiRequest, res);
  return res;
}
const status = (id: string) => (getDb().prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string }).status;

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'rs@x.io', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('rs-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES ('rs-run', ?, 'rs-wf', 'running')").run(WS);
  db.prepare("INSERT INTO targets (id, workspace_id, full_name) VALUES ('rs-t', ?, 'A')").run(WS);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rs-rp', 'rs-run', 'rs-t')").run();
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES ('rs-tr', 'rs-rp', 'linkedin', 'in_progress', 1)").run();
});

describe("changing a run's status", () => {
  it("rejects anything but pause, resume or stop, and unknown runs", async () => {
    expect((await patch("rs-run", "failed")).statusCode).toBe(400);
    expect((await patch("rs-run", "bogus")).statusCode).toBe(400);
    expect((await patch("nope", "paused")).statusCode).toBe(404);
    expect(status("rs-run")).toBe("running");
  });

  it("pauses and resumes", async () => {
    expect((await patch("rs-run", "paused")).statusCode).toBe(200);
    expect(status("rs-run")).toBe("paused");
    expect((await patch("rs-run", "paused")).statusCode).toBe(409);
    expect((await patch("rs-run", "running")).statusCode).toBe(200);
    expect(status("rs-run")).toBe("running");
  });

  it("stopping ends the leads' remaining steps, and a stopped run can't be resumed here", async () => {
    expect((await patch("rs-run", "completed")).statusCode).toBe(200);
    expect(status("rs-run")).toBe("completed");
    expect((getDb().prepare("SELECT state FROM run_profile_tracks WHERE id = 'rs-tr'").get() as { state: string }).state).toBe("skipped");
    expect((await patch("rs-run", "running")).statusCode).toBe(409);
  });
});
