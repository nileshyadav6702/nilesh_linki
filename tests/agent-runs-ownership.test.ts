import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createAgent, getAgent, updateAgent } from "@/lib/agents/store";
import { endAgentRuns, enrollLead, moveAgentMailbox, pauseAgentRuns } from "@/lib/agents/enroll";

const WS = "ws-agent-runs";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('ar-li-1', ?, 'A', 'a@ar.io', 1), ('ar-li-2', ?, 'B', 'b@ar.io', 1)").run(WS, WS);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES ('ar-mb-1', ?, 'M1', 'm1@ar.io', 'h', 'u', 'p'), ('ar-mb-2', ?, 'M2', 'm2@ar.io', 'h', 'u', 'p')").run(WS, WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('ar-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES ('ar-s1', 'ar-wf', 1, 'connect', 'linkedin'), ('ar-s2', 'ar-wf', 1, 'email', 'email')").run();
  for (const t of ["ar-t1", "ar-t2"]) db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, email) VALUES (?, ?, 'L', ?, ?)").run(t, WS, `https://www.linkedin.com/in/${t}`, `${t}@x.io`);
});

const runOf = (t: string) => (getDb().prepare("SELECT rp.run_id FROM run_profiles rp WHERE rp.target_id = ?").get(t) as { run_id: string }).run_id;
const runRow = (id: string) => getDb().prepare("SELECT status, agent_id, account_id, email_account_id FROM runs WHERE id = ?").get(id) as { status: string; agent_id: string; account_id: string; email_account_id: string };

describe("an agent owns its campaign runs", () => {
  it("records the agent on its run; a sender change starts a fresh run; pausing reaches both", () => {
    const db = getDb();
    const a = createAgent(WS, { name: "Owner", mode: "copilot", min_score: 10, fit_weight: 0.6, workflow_id: "ar-wf", linkedin_account_id: "ar-li-1", email_account_id: "ar-mb-1", autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
    db.prepare("UPDATE agents SET outreach_enabled = 1 WHERE id = ?").run(a.id);
    expect(enrollLead(db, getAgent(a.id, WS)!, "ar-t1").enrolled).toBe(true);
    const first = runOf("ar-t1");
    expect(runRow(first)).toMatchObject({ agent_id: a.id, account_id: "ar-li-1", status: "running" });

    updateAgent(a.id, WS, { linkedin_account_id: "ar-li-2" });
    expect(enrollLead(db, getAgent(a.id, WS)!, "ar-t2").enrolled).toBe(true);
    const second = runOf("ar-t2");
    expect(second).not.toBe(first);
    expect(runRow(second)).toMatchObject({ agent_id: a.id, account_id: "ar-li-2" });

    pauseAgentRuns(db, getAgent(a.id, WS)!);
    expect(runRow(first).status).toBe("paused");
    expect(runRow(second).status).toBe("paused");

    // A new mailbox takes over leads still waiting on email.
    expect(moveAgentMailbox(db, getAgent(a.id, WS)!, "ar-mb-2")).toBe(2);
    expect(runRow(first).email_account_id).toBe("ar-mb-2");

    // Deleting the agent ends its leads' sequences.
    expect(endAgentRuns(db, getAgent(a.id, WS)!)).toBe(2);
    expect(runRow(first).status).toBe("completed");
    const states = (db.prepare("SELECT DISTINCT rt.state FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id WHERE rp.run_id IN (?, ?)").all(first, second) as Array<{ state: string }>).map((r) => r.state);
    expect(states).toEqual(["skipped"]);
  });
});
