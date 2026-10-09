import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { dashboardSummary, getDealSize, setDealSize } from "@/lib/dashboard/summary";

const WS = "ws-dash";
const P = { from: "2026-10-01", to: "2026-10-07" };

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO agents (id, workspace_id, name, status) VALUES ('dash-a', ?, 'A', 'active')").run(WS);
  db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, enabled) VALUES ('dash-s1', 'dash-a', ?, 'job_change', 1), ('dash-s2', 'dash-a', ?, 'funding', 0)").run(WS, WS);
  const t = db.prepare(`INSERT INTO targets (id, workspace_id, full_name, created_at, lead_score, connection_requested_at, message_sent_at, last_replied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  t.run("dash-t1", WS, "Hot Ann", "2026-10-02 09:00:00", 82, "2026-10-02 10:00:00", "2026-10-03 10:00:00", "2026-10-04 10:00:00");
  t.run("dash-t2", WS, "Warm Bob", "2026-10-03 09:00:00", 55, "2026-10-03 10:00:00", null, null);
  t.run("dash-t3", WS, "Old Cy", "2026-09-01 09:00:00", 90, null, null, null);
});

describe("home dashboard", () => {
  it("counts the period's hot leads, invitations, messages and replies", () => {
    const d = dashboardSummary(getDb(), WS, P);
    expect(d).toMatchObject({ activeSignals: 1, linkedinAccounts: 0, hot: 1, invitations: 2, messages: 1, replies: 1 });
    expect(d.series).toHaveLength(7);
    expect(d.series.find((x) => x.day === "2026-10-03")).toMatchObject({ leads: 1, invitations: 1, messages: 1 });
    // Latest hot leads are not limited to the period.
    expect(d.hotLeads.map((l) => l.full_name)).toEqual(["Hot Ann", "Old Cy"]);
  });

  it("stores the average deal size per workspace", () => {
    const db = getDb();
    expect(getDealSize(db, WS)).toBeNull();
    setDealSize(db, WS, 3000);
    expect(dashboardSummary(db, WS, P).dealSize).toBe(3000);
    setDealSize(db, WS, null);
    expect(getDealSize(db, WS)).toBeNull();
  });
});
