import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createAgent, getAgent } from "@/lib/agents/store";
import { enrollLead } from "@/lib/agents/enroll";
import { addSuppression } from "@/lib/platform/suppression";

const WS = "ws-enroll-refuse";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('er-li', ?, 'A', 'a@er.io', 1)").run(WS);
  for (const wf of ["er-wf-a", "er-wf-b"]) {
    db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(wf, wf === "er-wf-a" ? "Campaign A" : "Campaign B", WS);
    db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, 1, 'connect', 'linkedin')").run(`${wf}-s`, wf);
  }
  const lead = db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, last_replied_at) VALUES (?, ?, 'L', ?, ?)");
  lead.run("er-busy", WS, "https://www.linkedin.com/in/er-busy", null);
  lead.run("er-optout", WS, "https://www.linkedin.com/in/er-optout", null);
  lead.run("er-recent", WS, "https://www.linkedin.com/in/er-recent", new Date(Date.now() - 5 * 86_400_000).toISOString());
  lead.run("er-old", WS, "https://www.linkedin.com/in/er-old", "2025-01-01T00:00:00.000Z");
});

const agentFor = (wf: string) => {
  const a = createAgent(WS, { name: `A ${wf}`, mode: "copilot", min_score: 10, fit_weight: 0.6, workflow_id: wf, linkedin_account_id: "er-li", autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
  return getAgent(a.id, WS)!;
};
const skipReason = (id: string) => (getDb().prepare("SELECT agent_status, skip_reason FROM targets WHERE id = ?").get(id) as { agent_status: string; skip_reason: string });

describe("who may be enrolled", () => {
  it("refuses a lead already active in another campaign, with the reason", () => {
    const db = getDb();
    const a = agentFor("er-wf-a");
    const b = agentFor("er-wf-b");
    expect(enrollLead(db, a, "er-busy").enrolled).toBe(true);
    const r = enrollLead(db, b, "er-busy");
    expect(r).toEqual({ enrolled: false, reason: 'Already in another active campaign ("Campaign A")' });
    expect(skipReason("er-busy").agent_status).toBe("enrolled"); // its first campaign stays
  });

  it("refuses do-not-contact and recent repliers, but re-engages someone who replied long ago", () => {
    const db = getDb();
    const a = agentFor("er-wf-b");
    addSuppression({ workspaceId: WS, kind: "linkedin", value: "https://www.linkedin.com/in/er-optout", reason: "asked us to stop", source: "test", targetId: "er-optout" });
    expect(enrollLead(db, a, "er-optout").enrolled).toBe(false);
    expect(skipReason("er-optout")).toMatchObject({ agent_status: "skipped", skip_reason: expect.stringMatching(/do-not-contact/) });
    expect(enrollLead(db, a, "er-recent").reason).toMatch(/Replied in the last 30 days/);
    expect(enrollLead(db, a, "er-old").enrolled).toBe(true);
  });
});
