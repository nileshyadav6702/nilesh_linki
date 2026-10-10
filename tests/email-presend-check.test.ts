import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { stoppedSinceClaim } from "@/lib/linkedin/campaign/steps/email";

const WS = "ws-presend";
beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('ps-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, status) VALUES ('ps-run', ?, 'ps-wf', 'running')").run(WS);
  const add = (id: string, state: string, replied: string | null) => {
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, email_replied_at) VALUES (?, ?, 'L', ?)").run(`ps-t-${id}`, WS, replied);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id, created_at) VALUES (?, 'ps-run', ?, '2026-10-01 10:00:00')").run(`ps-rp-${id}`, `ps-t-${id}`);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'email', ?, 1)").run(`ps-tr-${id}`, `ps-rp-${id}`, state);
  };
  add("live", "in_progress", null);
  add("replied", "in_progress", "2026-10-05T09:00:00.000Z");
  add("old-reply", "in_progress", "2026-09-01T09:00:00.000Z");
  add("stopped", "skipped", null);
});

describe("last look before an email goes out", () => {
  it("holds the send when the lead replied since enrolling or the track was stopped", () => {
    const db = getDb();
    expect(stoppedSinceClaim(db, "ps-tr-live")).toBe(false);
    expect(stoppedSinceClaim(db, "ps-tr-replied")).toBe(true);
    expect(stoppedSinceClaim(db, "ps-tr-old-reply")).toBe(false); // a reply from before this enrollment
    expect(stoppedSinceClaim(db, "ps-tr-stopped")).toBe(true);
  });
});
