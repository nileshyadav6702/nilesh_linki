import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { enforceSchedule, trAdvance, trWait } from "@/lib/linkedin/campaign/track-state";
import type { ScheduleConfig, TrackRun, WorkflowStep } from "@/lib/linkedin/campaign/types";

const WS = "ws-wait-reason";
beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('wr-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES ('wr-run', ?, 'wr-wf', 'running')").run(WS);
  db.prepare("INSERT INTO targets (id, workspace_id, full_name) VALUES ('wr-t', ?, 'L')").run(WS);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('wr-rp', 'wr-run', 'wr-t')").run();
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES ('wr-tr', 'wr-rp', 'linkedin', 'in_progress', 0)").run();
});
const tr = () => ({ ...(getDb().prepare("SELECT * FROM run_profile_tracks WHERE id = 'wr-tr'").get() as TrackRun), target_id: "wr-t" }) as TrackRun;
const reason = () => (getDb().prepare("SELECT wait_reason r FROM run_profile_tracks WHERE id = 'wr-tr'").get() as { r: string | null }).r;

describe("why a lead is waiting", () => {
  it("is recorded when it's parked and replaced as it moves on", () => {
    trWait(getDb(), tr(), 24, "Invitation sent — waiting for them to accept");
    expect(reason()).toBe("Invitation sent — waiting for them to accept");
    const steps = [{ id: "a", step_type: "connect", delay_seconds: 0 }, { id: "d", step_type: "delay", delay_seconds: 3 * 86400 }, { id: "m", step_type: "message", delay_seconds: 0 }] as unknown as WorkflowStep[];
    trAdvance(getDb(), tr(), steps);
    expect(reason()).toBe("Waiting 3 days before the next step");
    const closed = { active_hours_start: 0, active_hours_end: 0, timezone: "UTC", working_days: "1,2,3,4,5,6,7" } as unknown as ScheduleConfig;
    expect(enforceSchedule(getDb(), tr(), "wr-run", "wr-t", "L", closed)).toBe(false);
    expect(reason()).toBe("Outside the sender's working hours");
    trAdvance(getDb(), { ...tr(), current_step: 2 } as TrackRun, steps);
    expect(reason()).toBeNull();
  });
});
