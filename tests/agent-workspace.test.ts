import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { agentPerformance, dueToday, stepOccupancy } from "@/lib/agents/analytics";
import { addSource, createAgent, duplicateAgent, getAgent, listSources } from "@/lib/agents/store";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";

const WS = "ws-agent-workspace";

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Workspace", "agent-workspace");
});

describe("agent workspace", () => {
  it("counts lifetime performance for the agent's own leads", () => {
    const db = getDb();
    const workflowId = createDefaultCampaign(db, WS, "Perf", "multi");
    const agent = createAgent(WS, { name: "Perf agent", workflow_id: workflowId, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
    db.prepare(`INSERT INTO targets (id, workspace_id, agent_id, linkedin_url, full_name, connection_requested_at, connected_at, reply_kind, last_replied_at)
      VALUES ('t-perf', ?, ?, 'https://www.linkedin.com/in/perf', 'Pat', datetime('now'), datetime('now'), 'interested', datetime('now'))`).run(WS, agent.id);
    db.prepare(`INSERT INTO targets (id, workspace_id, agent_id, linkedin_url, full_name) VALUES ('t-perf-2', ?, ?, 'https://www.linkedin.com/in/perf-2', 'Sam')`).run(WS, agent.id);
    expect(agentPerformance(db, agent.id)).toMatchObject({ found: 2, contacted: 1, accepted: 1, replied: 1, interested: 1 });
  });

  it("duplicates the campaign and sources without copying leads", () => {
    const db = getDb();
    const workflowId = createDefaultCampaign(db, WS, "Copy me", "linkedin");
    const agent = createAgent(WS, { name: "Original", workflow_id: workflowId, mode: "autopilot", min_score: 40, fit_weight: 0.5, autopilot_delay_minutes: 30, daily_lead_cap: 10, enrich_emails: true, goal: "meetings", tone: "direct", channel: "linkedin" });
    addSource(agent.id, WS, "hiring", { keywords: ["sdr"] });
    db.prepare("UPDATE agents SET status = 'active', outreach_enabled = 1 WHERE id = ?").run(agent.id);
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, linkedin_url, full_name) VALUES ('t-keep', ?, ?, 'https://www.linkedin.com/in/keep', 'Keep')").run(WS, agent.id);

    const copy = duplicateAgent(agent.id, WS);
    expect(copy).toBeTruthy();
    expect(copy!.id).not.toBe(agent.id);
    expect(copy!.name).toBe("Original (copy)");
    expect(copy!.status).toBe("draft");
    expect(copy!.outreach_enabled).toBe(0);
    expect(copy!.workflow_id).toBeTruthy();
    expect(copy!.workflow_id).not.toBe(workflowId);
    expect(copy!.mode).toBe("autopilot");
    expect(copy!.goal).toBe("meetings");

    const originalSteps = db.prepare("SELECT COUNT(*) n FROM workflow_steps WHERE workflow_id = ?").get(workflowId) as { n: number };
    const copySteps = db.prepare("SELECT COUNT(*) n FROM workflow_steps WHERE workflow_id = ?").get(copy!.workflow_id) as { n: number };
    expect(copySteps.n).toBe(originalSteps.n);
    expect(copySteps.n).toBeGreaterThan(0);
    expect(listSources(copy!.id, WS)).toHaveLength(1);
    expect((db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ?").get(copy!.id) as { n: number }).n).toBe(0);
    expect(getAgent(agent.id, WS)!.status).toBe("active");
    expect((db.prepare("SELECT COUNT(*) n FROM targets WHERE agent_id = ?").get(agent.id) as { n: number }).n).toBe(1);
  });

  it("counts contacts that completed a step and have not moved past it", () => {
    const db = getDb();
    const workflowId = createDefaultCampaign(db, WS, "Occupancy", "linkedin");
    const agent = createAgent(WS, { name: "Occ", workflow_id: workflowId, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
    const runId = "run-occ";
    db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, list_id, status, started_at) VALUES (?, ?, ?, ?, 'running', datetime('now'))").run(runId, WS, workflowId, agent.list_id);
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, linkedin_url) VALUES ('t-occ', ?, ?, 'https://www.linkedin.com/in/occ')").run(WS, agent.id);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp-occ', ?, 't-occ')").run(runId);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES ('tr-occ', 'rp-occ', 'linkedin', 'in_progress', 1, datetime('now'))").run();
    const steps = stepOccupancy(db, workflowId);
    // Invitation (step 1) done, waiting before the first message: counted on the invitation.
    const invite = steps.find((s) => s.track === "linkedin" && s.step_order === 1);
    expect(invite?.contacts).toBe(1);
    expect(invite).toMatchObject({ invited: 1, accepted: 0 });
    expect(steps.filter((s) => s.step_type !== "connect").every((s) => s.contacts === 0)).toBe(true);
    expect(dueToday(db, workflowId)).toBe(1);

    // A second lead: invitation sent, not yet accepted, so the track still sits on the invitation step.
    const connectStep = (db.prepare("SELECT id FROM workflow_steps WHERE workflow_id = ? AND track = 'linkedin' AND step_order = 1").get(workflowId) as { id: string }).id;
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, linkedin_url) VALUES ('t-occ2', ?, ?, 'https://www.linkedin.com/in/occ2')").run(WS, agent.id);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp-occ2', ?, 't-occ2')").run(runId);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES ('tr-occ2', 'rp-occ2', 'linkedin', 'in_progress', 0, datetime('now', '+6 hours'))").run();
    db.prepare(`INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status)
      VALUES ('la-occ2', 'li:connect:occ2', NULL, ?, 'tr-occ2', ?, 't-occ2', 'connect', 'sent')`).run(runId, connectStep);
    expect(stepOccupancy(db, workflowId).find((s) => s.track === "linkedin" && s.step_order === 1)).toMatchObject({ contacts: 2, invited: 2, accepted: 0 });
  });
});

describe("due today", () => {
  it("counts not-started leads only up to the account's daily cap", () => {
    const db = getDb();
    db.prepare("INSERT INTO accounts (id, workspace_id, name, email, daily_connection_limit) VALUES ('acc-due', ?, 'A', 'due@x.io', 3)").run(WS);
    db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('wf-due', 'Due', ?)").run(WS);
    db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, account_id, status) VALUES ('run-due', ?, 'wf-due', 'acc-due', 'running')").run(WS);
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO targets (id, workspace_id, full_name) VALUES (?, ?, 'L')").run(`t-due-${i}`, WS);
      db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, 'run-due', ?)").run(`rp-due-${i}`, `t-due-${i}`);
      db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'pending', 0)").run(`tr-due-${i}`, `rp-due-${i}`);
    }
    expect(dueToday(db, "wf-due")).toBe(3);
    // One under way, due in an hour: counted on top.
    db.prepare("UPDATE run_profile_tracks SET state = 'in_progress', next_step_at = datetime('now', '+1 hour') WHERE id = 'tr-due-0'").run();
    expect(dueToday(db, "wf-due")).toBe(4);
  });
});
