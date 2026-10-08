import { randomUUID } from "crypto";
import { describe, it, expect } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { invitationExpired, skipAfterDays, skipToEmail } from "@/lib/linkedin/campaign/invitation-fallback";
import { staleInvitations } from "@/lib/linkedin/campaign/withdraw-stale";
import stepsHandler from "@/pages/api/workflows/[id]/steps";
import stepHandler from "@/pages/api/workflows/[id]/steps/[stepId]";
import voiceHandler from "@/pages/api/workflows/[id]/steps/[stepId]/voice";
import type { TrackRun, WorkflowStep } from "@/lib/linkedin/campaign/types";

/** Skip-after-N-days, invitation withdrawal, and the new step options behind the Campaign tab. */

const WS = "00000000-0000-4000-8000-000000000001";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.send = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: string) => { (res.headers as Record<string, string>)[k] = v; return res; };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
const req = (method: string, query: Record<string, string>, body: unknown = {}) =>
  ({ method, query, body, headers: { "x-workspace-id": WS, "x-workspace-role": "admin" } }) as unknown as NextApiRequest;

function workflow(steps: Array<[string, Record<string, unknown>?]>): { id: string; stepIds: string[] } {
  const db = getDb();
  const id = randomUUID();
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, 'Opts', ?)").run(id, WS);
  const stepIds = steps.map(([type, extra], i) => {
    const sid = randomUUID();
    db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, track, step_type, delay_seconds) VALUES (?, ?, ?, 'linkedin', ?, ?)").run(sid, id, i + 1, type, type === "delay" ? 86_400 : 0);
    for (const [k, v] of Object.entries(extra ?? {})) db.prepare(`UPDATE workflow_steps SET ${k} = ? WHERE id = ?`).run(v, sid);
    return sid;
  });
  return { id, stepIds };
}

const step = (o: Partial<WorkflowStep>) => ({ step_type: "connect", ...o }) as WorkflowStep;

describe("skip after N days", () => {
  it("reads the invitation step's setting; 0 means wait indefinitely", () => {
    expect(skipAfterDays([step({})])).toBe(7);
    expect(skipAfterDays([step({ skip_after_days: 3 })])).toBe(3);
    expect(skipAfterDays([step({ skip_after_days: 0 })])).toBeNull();
    expect(invitationExpired([step({ skip_after_days: 3 })], daysAgo(4))).toBe(true);
    expect(invitationExpired([step({ skip_after_days: 3 })], daysAgo(2))).toBe(false);
    expect(invitationExpired([step({ skip_after_days: 0 })], daysAgo(400))).toBe(false);
  });

  it("skips the LinkedIn track and brings the lead's next email forward", () => {
    const db = getDb();
    const { id: wf } = workflow([["connect"]]);
    const runId = randomUUID(); const targetId = randomUUID(); const rp = randomUUID();
    db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES (?, ?, ?, 'running')").run(runId, WS, wf);
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url) VALUES (?, ?, 'Kat', ?)").run(targetId, WS, `https://www.linkedin.com/in/kat-${targetId}`);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(rp, runId, targetId);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', 0)").run(`li-${rp}`, rp);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES (?, ?, 'email', 'in_progress', 1, datetime('now', '+5 days'))").run(`em-${rp}`, rp);
    const moved = skipToEmail(db, runId, { id: `li-${rp}`, run_profile_id: rp } as TrackRun, targetId, "Kat", [step({ skip_after_days: 5 })]);
    expect(moved).toBe(true);
    expect((db.prepare("SELECT state FROM run_profile_tracks WHERE id = ?").get(`li-${rp}`) as { state: string }).state).toBe("skipped");
    const email = db.prepare("SELECT next_step_at <= datetime('now') due FROM run_profile_tracks WHERE id = ?").get(`em-${rp}`) as { due: number };
    expect(email.due).toBe(1);
  });
});

describe("stale invitation withdrawal", () => {
  it("picks sent invitations past their window that were never accepted, once", () => {
    const db = getDb();
    const account = `acct-${randomUUID()}`;
    db.prepare("INSERT INTO accounts (id, name, email, workspace_id) VALUES (?, 'W', ?, ?)").run(account, `${account}@x.com`, WS);
    const { stepIds: [connect30] } = workflow([["connect", { withdraw_after_days: 30 }]]);
    const { stepIds: [connectNever] } = workflow([["connect", { withdraw_after_days: 0 }]]);
    const invite = (stepId: string, age: number, extra: { connected?: boolean; withdrawn?: boolean } = {}) => {
      const t = randomUUID();
      db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, connected_at) VALUES (?, ?, 'L', ?, ?)").run(t, WS, `https://www.linkedin.com/in/l-${t}`, extra.connected ? daysAgo(1) : null);
      db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at) VALUES (?, ?, ?, 'r', 'tr', ?, ?, 'connect', 'sent', datetime('now', ?))")
        .run(randomUUID(), `k-${t}`, account, stepId, t, `-${age} days`);
      if (extra.withdrawn) db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, target_id, type, status) VALUES (?, ?, ?, ?, 'withdraw', 'sent')").run(randomUUID(), `w-${t}`, account, t);
      return t;
    };
    const due = invite(connect30, 31);
    invite(connect30, 10);
    invite(connect30, 40, { connected: true });
    invite(connect30, 40, { withdrawn: true });
    invite(connectNever, 200);
    expect(staleInvitations(db, account, 10).map((s) => s.target_id)).toEqual([due]);
  });
});

describe("step options API", () => {
  it("keeps each step's id when steps above it are removed, so its recording stays with it", () => {
    const db = getDb();
    const { id: wf, stepIds: [connect, wait, msg, voice] } = workflow([["connect"], ["delay"], ["message"], ["voice"]]);
    db.prepare("INSERT INTO step_media (step_id, mime, data, duration_ms) VALUES (?, 'audio/webm', ?, 4000)").run(voice, Buffer.from("abc"));
    const rows = db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order").all(wf) as Array<Record<string, unknown>>;
    const res = mockRes();
    stepsHandler(req("PUT", { id: wf }, { steps: rows.filter((r) => r.id !== wait).map((r) => r.id === voice ? { ...r, like_count: 9 } : r) }), res);
    expect(res.statusCode).toBe(200);
    const after = db.prepare("SELECT id, step_type, step_order FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order").all(wf) as Array<{ id: string; step_type: string; step_order: number }>;
    expect(after.map((r) => [r.id, r.step_type, r.step_order])).toEqual([[connect, "connect", 1], [msg, "message", 2], [voice, "voice", 3]]);
    expect(db.prepare("SELECT 1 FROM step_media WHERE step_id = ?").get(voice)).toBeTruthy();
    const listed = mockRes();
    stepsHandler(req("GET", { id: wf }), listed);
    expect((listed.body as Array<{ id: string; voice_duration_ms: number | null }>).find((s) => s.id === voice)?.voice_duration_ms).toBe(4000);
  });

  it("clamps like_count / skip_after_days and stores voice recordings only on voice steps", () => {
    const db = getDb();
    const { id: wf, stepIds: [connect, like, voice] } = workflow([["connect"], ["like_posts"], ["voice"]]);
    stepHandler(req("PUT", { id: wf, stepId: like }, { like_count: 7 }), mockRes());
    stepHandler(req("PUT", { id: wf, stepId: connect }, { skip_after_days: 4, withdraw_after_days: 500 }), mockRes());
    expect(db.prepare("SELECT like_count FROM workflow_steps WHERE id = ?").get(like)).toEqual({ like_count: 3 });
    expect(db.prepare("SELECT skip_after_days, withdraw_after_days FROM workflow_steps WHERE id = ?").get(connect)).toEqual({ skip_after_days: 4, withdraw_after_days: 90 });

    const body = { audio_base64: Buffer.from("voice-bytes").toString("base64"), mime: "audio/webm;codecs=opus", duration_ms: 3200 };
    const wrong = mockRes(); voiceHandler(req("POST", { id: wf, stepId: like }, body), wrong);
    expect(wrong.statusCode).toBe(400);
    const badMime = mockRes(); voiceHandler(req("POST", { id: wf, stepId: voice }, { ...body, mime: "text/html" }), badMime);
    expect(badMime.statusCode).toBe(400);
    const ok = mockRes(); voiceHandler(req("POST", { id: wf, stepId: voice }, body), ok);
    expect(ok.statusCode).toBe(200);
    const got = mockRes(); voiceHandler(req("GET", { id: wf, stepId: voice }), got);
    expect(Buffer.from(got.body as Buffer).toString()).toBe("voice-bytes");
  });
});
