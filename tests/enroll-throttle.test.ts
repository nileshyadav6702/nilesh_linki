import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { enrollPendingEmailTracks } from "@/lib/linkedin/campaign/runs";
import { rescheduleToTomorrow } from "@/lib/linkedin/campaign/schedule";
import type { EmailAccountLimits } from "@/lib/linkedin/campaign/types";

const WS = "ws-enroll-throttle";
afterEach(() => { vi.useRealTimers(); });

describe("rescheduling", () => {
  it("moves a Friday-evening slot to the next working day, not the weekend", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T19:00:00Z")); // Friday
    const slot = new Date(rescheduleToTomorrow({ active_hours_start: 9, active_hours_end: 17, timezone: "UTC", working_days: "1,2,3,4,5" }));
    expect(slot.getUTCDay()).toBe(1); // Monday
    expect(slot.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(slot.getUTCHours()).toBeLessThan(17);
  });
});

describe("email enrollment throttle", () => {
  beforeAll(() => {
    const db = getDb();
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
    db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('et-wf', 'W', ?)").run(WS);
    db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES ('et-mb', ?, 'M', 'm@et.io', 'h', 'u', 'p')").run(WS);
    db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, email_account_id, status) VALUES ('et-run', ?, 'et-wf', 'et-mb', 'running')").run(WS);
    for (let i = 0; i < 20; i++) {
      db.prepare("INSERT INTO targets (id, workspace_id, full_name, email, intent_score) VALUES (?, ?, 'L', ?, ?)").run(`et-t${i}`, WS, `l${i}@x.io`, i);
      db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, 'et-run', ?, 'et-mb')").run(`et-rp${i}`, `et-t${i}`);
      db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'email', 'pending', 0)").run(`et-tr${i}`, `et-rp${i}`);
    }
  });

  it("after hours, repeated passes never enrol more than one day's cap, highest intent first", () => {
    // A window that is closed right now (working day: none today... use hours that already ended).
    const now = new Date();
    const closed: EmailAccountLimits = {
      daily_email_limit: 6, ramp_up_enabled: 0, ramp_start_date: null,
      active_hours_start: (now.getUTCHours() + 2) % 24, active_hours_end: (now.getUTCHours() + 3) % 24 || 24, timezone: "UTC", working_days: "1,2,3,4,5,6,7",
    };
    for (let pass = 0; pass < 6; pass++) enrollPendingEmailTracks(getDb(), "et-run", "et-mb", closed, 0);
    const started = getDb().prepare("SELECT rp.target_id FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id WHERE rp.run_id = 'et-run' AND rt.state = 'in_progress'").all() as Array<{ target_id: string }>;
    expect(started).toHaveLength(6);
    expect(started.map((s) => Number(s.target_id.slice(4))).sort((a, b) => b - a)).toEqual([19, 18, 17, 16, 15, 14]);
  });
});
