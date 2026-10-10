import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createAgent, getAgent } from "@/lib/agents/store";
import { enrollLead } from "@/lib/agents/enroll";
import { assignRunMailboxes } from "@/lib/linkedin/campaign/email-tick";

const WS = "ws-enroll-mailbox";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES ('mb-1', ?, 'Me', 'me@acme.io', 'smtp.acme.io', 'me', 'x')").run(WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('wf-mail', 'Mail', ?)").run(WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, email_subject, email_body) VALUES ('st-mail', 'wf-mail', 1, 'email', 'email', 'Hi', 'Hello')").run();
});

describe("email campaigns from agents", () => {
  it("enrolls the lead with the agent's mailbox, so the email loop works it right away", () => {
    const db = getDb();
    const a = createAgent(WS, { name: "Mailer", mode: "copilot", min_score: 10, fit_weight: 0.6, workflow_id: "wf-mail", email_account_id: "mb-1", autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, channel: "email" });
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, email) VALUES ('t-mail', ?, 'Jane', 'jane@x.io')").run(WS);
    expect(enrollLead(db, getAgent(a.id, WS)!, "t-mail")).toEqual({ enrolled: true });
    const rp = db.prepare("SELECT rp.email_account_id, rt.track FROM run_profiles rp JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id WHERE rp.target_id = 't-mail'").get();
    expect(rp).toEqual({ email_account_id: "mb-1", track: "email" });
  });

  it("gives leads enrolled without a mailbox their run's mailbox on the next email pass", () => {
    const db = getDb();
    db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, email_account_id, status) VALUES ('run-old', ?, 'wf-mail', 'mb-1', 'running')").run(WS);
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, email) VALUES ('t-old', ?, 'Old', 'old@x.io')").run(WS);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp-old', 'run-old', 't-old')").run();
    expect(assignRunMailboxes(db)).toBeGreaterThanOrEqual(1);
    expect(db.prepare("SELECT email_account_id FROM run_profiles WHERE id = 'rp-old'").get()).toEqual({ email_account_id: "mb-1" });
  });
});
