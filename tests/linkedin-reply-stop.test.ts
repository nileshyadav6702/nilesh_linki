import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { addMessages, upsertThread } from "@/lib/inbox/store";

const WS = "ws-li-reply";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('acc-li-r', ?, 'Me', 'me@r.io', 1)").run(WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('wf-li-r', 'R', ?)").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, account_id, status) VALUES ('run-li-r', ?, 'wf-li-r', 'acc-li-r', 'running')").run(WS);
  const lead = db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, email) VALUES (?, ?, ?, ?, ?)");
  lead.run("t-replied", WS, "Jane", "https://www.linkedin.com/in/jane-r", "jane@x.io");
  lead.run("t-early", WS, "Early", "https://www.linkedin.com/in/early-r", null);
  lead.run("t-stranger", WS, "Stranger", "https://www.linkedin.com/in/stranger-r", null);
  for (const t of ["t-replied", "t-early", "t-stranger"]) {
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, 'run-li-r', ?)").run(`rp-${t}`, t);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', 1), (?, ?, 'email', 'in_progress', 0)")
      .run(`li-${t}`, `rp-${t}`, `em-${t}`, `rp-${t}`);
  }
  db.pragma("foreign_keys = OFF");
  const act = db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at) VALUES (?, ?, 'acc-li-r', 'run-li-r', 'tr', 's', ?, 'connect', 'sent', '2026-10-05 10:00:00')");
  act.run("la-replied", "k-replied", "t-replied");
  act.run("la-early", "k-early", "t-early");
  db.prepare("INSERT INTO email_jobs (id, workspace_id, email_account_id, idempotency_key, target_id, recipient, subject, body_text, status, source) VALUES ('ej-r', ?, 'mb-x', 'campaign:x', 't-replied', 'jane@x.io', 'Hi', 'Hello', 'pending', 'campaign')").run(WS);
  db.pragma("foreign_keys = ON");
});

function converse(targetUrl: string, externalId: string, inboundAt: string) {
  const db = getDb();
  const { id } = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: "acc-li-r", externalId, participantName: "X", participantUrl: targetUrl, lastMessageAt: inboundAt });
  addMessages(db, id, [{ externalId: `${externalId}-m1`, direction: "in", senderName: "X", bodyText: "Sounds interesting", sentAt: inboundAt }]);
}
const tracks = (t: string) => (getDb().prepare("SELECT state FROM run_profile_tracks WHERE run_profile_id = ? ORDER BY track").all(`rp-${t}`) as Array<{ state: string }>).map((r) => r.state);

describe("a LinkedIn reply ends the sequence", () => {
  it("marks the lead replied, stops LinkedIn and email, and cancels queued emails", () => {
    converse("https://www.linkedin.com/in/jane-r", "th-replied", "2026-10-06T09:00:00.000Z");
    expect((getDb().prepare("SELECT last_replied_at FROM targets WHERE id = 't-replied'").get() as { last_replied_at: string }).last_replied_at).toBe("2026-10-06T09:00:00.000Z");
    expect(tracks("t-replied")).toEqual(["skipped", "skipped"]);
    expect((getDb().prepare("SELECT status FROM email_jobs WHERE id = 'ej-r'").get() as { status: string }).status).toBe("cancelled");
  });

  it("ignores messages from before our outreach and conversations with people we never contacted", () => {
    converse("https://www.linkedin.com/in/early-r", "th-early", "2026-10-01T09:00:00.000Z");
    converse("https://www.linkedin.com/in/stranger-r", "th-stranger", "2026-10-06T09:00:00.000Z");
    expect(tracks("t-early")).toEqual(["in_progress", "in_progress"]);
    expect(tracks("t-stranger")).toEqual(["in_progress", "in_progress"]);
  });
});

describe("out-of-office auto-replies", () => {
  it("a LinkedIn away message holds the sequence for a week instead of ending it", () => {
    const db = getDb();
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url) VALUES ('t-away', ?, 'Away', 'https://www.linkedin.com/in/away-r')").run(WS);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp-t-away', 'run-li-r', 't-away')").run();
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES ('li-t-away', 'rp-t-away', 'linkedin', 'in_progress', 1)").run();
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at) VALUES ('la-away', 'k-away', 'acc-li-r', 'run-li-r', 'tr', 's', 't-away', 'connect', 'sent', '2026-10-05 10:00:00')").run();
    db.pragma("foreign_keys = ON");
    const { id } = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: "acc-li-r", externalId: "th-away", participantName: "Away", participantUrl: "https://www.linkedin.com/in/away-r", lastMessageAt: "2026-10-06T09:00:00.000Z" });
    addMessages(db, id, [{ externalId: "th-away-m1", direction: "in", senderName: "Away", bodyText: "Thanks for your message. I'm out of the office until Monday.", sentAt: "2026-10-06T09:00:00.000Z" }]);
    const tr = db.prepare("SELECT state, next_step_at FROM run_profile_tracks WHERE id = 'li-t-away'").get() as { state: string; next_step_at: string };
    expect(tr.state).toBe("in_progress");
    expect(tr.next_step_at).toBe("2026-10-13T09:00:00.000Z");
    expect((db.prepare("SELECT last_replied_at FROM targets WHERE id = 't-away'").get() as { last_replied_at: string | null }).last_replied_at).toBeNull();
  });
});
