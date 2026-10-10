import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import stepsHandler from "@/pages/api/workflows/[id]/steps";
import stepHandler from "@/pages/api/workflows/[id]/steps/[stepId]";
import { newPosition } from "@/lib/linkedin/campaign/sequence-remap";

const WS = "ws-live-edit";
const USER = "user-live-edit";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
const headers = { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" };

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'le@x.io', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
});

let n = 0;
/** Workflow with LinkedIn steps A (connect), B (message), C (message) and leads at given positions. */
function setup(positions: Array<{ at: number; state?: string }>) {
  const db = getDb();
  const wf = `wf-le-${++n}`;
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, 'LE', ?)").run(wf, WS);
  ["A", "B", "C"].forEach((s, i) => db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, ?, ?, 'linkedin')").run(`${wf}-${s}`, wf, i + 1, i ? "message" : "connect"));
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES (?, ?, ?, 'running')").run(`${wf}-run`, WS, wf);
  const tracks = positions.map((p, i) => {
    db.prepare("INSERT INTO targets (id, workspace_id, full_name) VALUES (?, ?, 'L')").run(`${wf}-t${i}`, WS);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(`${wf}-rp${i}`, `${wf}-run`, `${wf}-t${i}`);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', ?, ?)").run(`${wf}-tr${i}`, `${wf}-rp${i}`, p.state ?? "in_progress", p.at);
    return `${wf}-tr${i}`;
  });
  return { wf, tracks, step: (s: string) => `${wf}-${s}` };
}
const track = (id: string) => getDb().prepare("SELECT state, current_step FROM run_profile_tracks WHERE id = ?").get(id) as { state: string; current_step: number };
async function save(wf: string, steps: Array<Record<string, unknown>>) {
  const res = mockRes();
  await stepsHandler({ method: "PUT", query: { id: wf }, body: { steps }, headers } as unknown as NextApiRequest, res);
  expect(res.statusCode).toBe(200);
}
const ids = (wf: string) => (getDb().prepare("SELECT id FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order").all(wf) as Array<{ id: string }>).map((r) => r.id);

describe("editing a live sequence keeps every lead in place", () => {
  it("computes positions by step id", () => {
    expect(newPosition({ nextId: "B", doneIds: ["A"] }, ["X", "A", "B", "C"])).toBe(2); // step added above: stays on B
    expect(newPosition({ nextId: "B", doneIds: ["A"] }, ["A", "C"])).toBe(1); // its next step deleted: continues after A
    expect(newPosition({ nextId: "C", doneIds: ["A", "B"] }, ["A", "B"])).toBe(2); // nothing left
  });

  it("a step added at the top doesn't move leads mid-sequence; leads not started begin at it; new steps get fresh ids", async () => {
    const { wf, tracks, step } = setup([{ at: 1 }, { at: 0, state: "pending" }]);
    await save(wf, [
      { id: "new-1", step_type: "visit", track: "linkedin" },
      { id: step("A"), step_type: "connect", track: "linkedin" },
      { id: step("B"), step_type: "message", track: "linkedin" },
      { id: step("C"), step_type: "message", track: "linkedin" },
    ]);
    const now = ids(wf);
    expect(now.slice(1)).toEqual([step("A"), step("B"), step("C")]);
    expect(now[0]).not.toMatch(/^new-/);
    expect(track(tracks[0]).current_step).toBe(2); // still about to run B
    expect(track(tracks[1])).toEqual({ state: "pending", current_step: 0 });
  });

  it("deleting a lead's next step moves it on to the following one; deleting the last remaining step finishes it", async () => {
    const { wf, tracks, step } = setup([{ at: 1 }, { at: 2 }]);
    await save(wf, [{ id: step("A"), step_type: "connect", track: "linkedin" }, { id: step("C"), step_type: "message", track: "linkedin" }]);
    expect(track(tracks[0]).current_step).toBe(1); // B gone → C, now at position 1
    expect(track(tracks[1]).current_step).toBe(1); // was about to run C, still C
    const res = mockRes();
    await stepHandler({ method: "DELETE", query: { id: wf, stepId: step("C") }, headers } as unknown as NextApiRequest, res);
    expect(track(tracks[0])).toEqual({ state: "completed", current_step: 1 });
    expect(ids(wf)).toEqual([step("A")]);
  });

  it("a deleted step's id is never handed to a new step", async () => {
    const { wf, step } = setup([]);
    await save(wf, [{ id: step("A"), step_type: "connect", track: "linkedin" }, { id: "new-2", step_type: "message", track: "linkedin" }]);
    const now = ids(wf);
    expect(now).toHaveLength(2);
    expect([step("B"), step("C")]).not.toContain(now[1]);
  });
});
