import { beforeAll, describe, expect, it, vi } from "vitest";

const used = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/linkedin/session", () => ({
  browserUseCount: (id: string) => used.get(id) ?? 0,
  getSessionPage: vi.fn(async (id: string) => { used.set(id, (used.get(id) ?? 0) + 1); return {}; }),
  getSessionContext: vi.fn(async () => ({})),
  closeSession: vi.fn(async () => {}), saveSessionState: vi.fn(async () => true), dropStaleSession: vi.fn(),
}));
vi.mock("@/lib/linkedin/sync-accepted", () => ({ shouldSyncAccepted: () => false, syncAcceptedConnections: vi.fn(async () => 0) }));
const executed = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/linkedin/campaign/steps", async () => {
  const { getSessionPage } = await import("@/lib/linkedin/session");
  return {
    // Connected leads get messaged (a browser action); the others only wait.
    executeStep: vi.fn(async (_db: unknown, _run: string, tr: { account_id: string }, target: { id: string; degree: number | null }) => {
      executed.push(target.id);
      if (target.degree === 1) await getSessionPage(tr.account_id);
    }),
  };
});
const delays = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/linkedin/campaign/track-state", async (orig) => ({
  ...(await orig<typeof import("@/lib/linkedin/campaign/track-state")>()),
  randomDelay: vi.fn(async () => { delays.n++; }),
}));

import { getDb } from "@/lib/db";
import { tick } from "@/lib/linkedin/campaign/tick";

const WS = "ws-tick-slots";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare(`INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, daily_message_limit, active_hours_start, active_hours_end, timezone, working_days)
    VALUES ('acc-ts', ?, 'A', 'ts@x.io', 1, 1, 0, 24, 'UTC', '1,2,3,4,5,6,7')`).run(WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('wf-ts', 'W', ?)").run(WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES ('wf-ts-m', 'wf-ts', 1, 'message', 'linkedin')").run();
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, account_id, status) VALUES ('run-ts', ?, 'wf-ts', 'acc-ts', 'running')").run(WS);
  // Two invited-but-not-connected leads first in line, then one connected lead.
  for (const [i, degree] of [[0, 2], [1, 2], [2, 1]] as const) {
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, degree, connection_requested_at) VALUES (?, ?, 'L', ?, ?, datetime('now', '-1 day'))").run(`ts-t${i}`, WS, `https://www.linkedin.com/in/ts${i}`, degree);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id, created_at) VALUES (?, 'run-ts', ?, datetime('now', ?))").run(`ts-rp${i}`, `ts-t${i}`, `-${10 - i} minutes`);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES (?, ?, 'linkedin', 'in_progress', 0, datetime('now', ?))").run(`ts-tr${i}`, `ts-rp${i}`, `-${10 - i} minutes`);
  }
});

describe("LinkedIn message slots", () => {
  it("leads still waiting on acceptance don't use up the day's messages, and only browser steps pause", async () => {
    await tick(getDb());
    expect(executed.sort()).toEqual(["ts-t0", "ts-t1", "ts-t2"]);
    expect(getDb().prepare("SELECT COUNT(*) n FROM logs WHERE run_id = 'run-ts' AND message LIKE 'Daily LinkedIn messages limit%'").get()).toEqual({ n: 0 });
    expect(delays.n).toBe(1);
  });
});
