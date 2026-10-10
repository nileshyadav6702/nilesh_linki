import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { emailCampaignTick } from "@/lib/linkedin/runner";
import { processEmailJobs } from "@/lib/email/infrastructure";
import { campaignEmailsToday } from "@/lib/linkedin/actions";

/**
 * A transient SMTP error must not fail the track, and the retry must be the campaign step's:
 * sent once, inside the mailbox's schedule/cap/pacing, counted, with the track advancing
 * only after the real send. Follow-ups thread onto the first email and every campaign email
 * carries one-click unsubscribe headers.
 */

const SEND_EMAIL = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/sender")>();
  return { ...actual, sendEmail: SEND_EMAIL };
});

const WS = "ws-email-retry";
const transient = () => Object.assign(new Error("451 4.3.0 Temporary local problem, try again later"), { responseCode: 451 });
const accepted = (_a: unknown, _to: string, _s: string, _b: string, opts: { messageId: string }) =>
  Promise.resolve({ messageId: opts.messageId, response: "250 OK" });

function seed(id: string, opts: { followupSubject?: string; bodyTemplate?: string } = {}) {
  const db = getDb();
  const wf = `wf-${id}`, mail = `mail-${id}`, tgt = `tgt-${id}`, run = `run-${id}`, rp = `rp-${id}`;
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(wf, id, WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, email_subject, email_body, email_position) VALUES (?, ?, 1, 'email', 'email', ?, ?, 1)")
    .run(`s1-${id}`, wf, "Hello {{first_name}}", opts.bodyTemplate ?? "Hi {{first_name}}, quick question.");
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, email_subject, email_body, email_position) VALUES (?, ?, 2, 'email', 'email', ?, ?, 2)")
    .run(`s2-${id}`, wf, opts.followupSubject ?? "", "Just bumping this, {{first_name|there}}.");
  db.prepare(`INSERT INTO email_accounts (id, name, from_email, reply_to, smtp_host, username, password, workspace_id,
      daily_email_limit, active_hours_start, active_hours_end, timezone, working_days)
    VALUES (?, ?, ?, ?, 'smtp.test', 'u', 'p', ?, 50, 0, 24, 'UTC', '1,2,3,4,5,6,7')`).run(mail, id, `${id}@sender.test`, `reply-${id}@sender.test`, WS);
  db.prepare("INSERT INTO targets (id, linkedin_url, full_name, first_name, email, email_status, workspace_id) VALUES (?, ?, ?, ?, ?, 'valid', ?)")
    .run(tgt, `https://www.linkedin.com/in/${id}`, "Ada Lovelace", "Ada", `${id}@prospect.test`, WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, email_account_id, status) VALUES (?, ?, ?, ?, 'running')").run(run, WS, wf, mail);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)").run(rp, run, tgt, mail);
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES (?, ?, 'email', 'in_progress', 0, NULL)").run(`tr-${id}`, rp);
  return { mail, run, track: `tr-${id}`, key: `campaign:${run}:tr-${id}:s1-${id}` };
}

const track = (id: string) => getDb().prepare("SELECT state, current_step, next_step_at, error_message, last_email_subject FROM run_profile_tracks WHERE id = ?").get(id) as
  { state: string; current_step: number; next_step_at: string | null; error_message: string | null; last_email_subject: string | null };
const job = (key: string) => getDb().prepare("SELECT id, status, attempt FROM email_jobs WHERE idempotency_key = ?").get(key) as { id: string; status: string; attempt: number };
const makeDue = (trackId: string) => getDb().prepare("UPDATE run_profile_tracks SET next_step_at = NULL WHERE id = ?").run(trackId);
const jobDue = (key: string) => getDb().prepare("UPDATE email_jobs SET available_at = datetime('now', '-1 minute') WHERE idempotency_key = ?").run(key);

beforeAll(() => {
  process.env.EMAIL_TRACKING_SECRET = "test-unsubscribe-secret";
  process.env.EMAIL_TRACKING_BASE_URL = "https://app.linki.test";
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Retry WS", "retry-ws");
});
beforeEach(() => {
  SEND_EMAIL.mockReset();
  // Each test drives only the run it seeds: the tick works every running run.
  getDb().prepare("UPDATE runs SET status = 'paused' WHERE workspace_id = ?").run(WS);
});

describe("campaign email retry", () => {
  it("keeps the track waiting on a transient error, then sends once inside the window and counts it", async () => {
    const s = seed("transient");
    SEND_EMAIL.mockRejectedValueOnce(transient());
    await emailCampaignTick(getDb());

    expect(SEND_EMAIL).toHaveBeenCalledTimes(1);
    let t = track(s.track);
    expect(t.state).toBe("in_progress");
    expect(t.current_step).toBe(0);
    expect(Date.parse(t.next_step_at!)).toBeGreaterThan(Date.now());
    expect(job(s.key).status).toBe("pending");
    expect(campaignEmailsToday(getDb(), s.mail, "UTC")).toBe(0);

    // The generic queue never sends a campaign job behind the step's back.
    jobDue(s.key);
    await processEmailJobs();
    expect(SEND_EMAIL).toHaveBeenCalledTimes(1);

    // Due again, but outside the mailbox's working hours: nothing is sent.
    getDb().prepare("UPDATE email_accounts SET active_hours_start = 0, active_hours_end = 0 WHERE id = ?").run(s.mail);
    makeDue(s.track);
    await emailCampaignTick(getDb());
    expect(SEND_EMAIL).toHaveBeenCalledTimes(1);
    expect(job(s.key).status).toBe("pending");

    // Back inside the window: the step re-sends the same job and the track advances.
    getDb().prepare("UPDATE email_accounts SET active_hours_start = 0, active_hours_end = 24 WHERE id = ?").run(s.mail);
    makeDue(s.track);
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());

    expect(SEND_EMAIL).toHaveBeenCalledTimes(2);
    expect(job(s.key)).toMatchObject({ status: "sent", attempt: 2 });
    t = track(s.track);
    expect(t.current_step).toBe(1);
    expect(t.last_email_subject).toBe("Hello Ada");
    expect(campaignEmailsToday(getDb(), s.mail, "UTC")).toBe(1);
    expect((getDb().prepare("SELECT COUNT(*) c FROM sent_messages WHERE job_id = ?").get(job(s.key).id) as { c: number }).c).toBe(1);
  });

  it("fails the track once the retry budget is spent", async () => {
    const s = seed("permanent");
    SEND_EMAIL.mockRejectedValue(transient());
    for (let i = 0; i < 3; i++) {
      makeDue(s.track);
      jobDue(s.key);
      await emailCampaignTick(getDb());
    }
    expect(SEND_EMAIL).toHaveBeenCalledTimes(3);
    expect(job(s.key).status).toBe("failed");
    expect(track(s.track).state).toBe("failed");
  });
});

describe("campaign headers", () => {
  it("adds one-click unsubscribe headers and threads a blank-subject follow-up onto the first email", async () => {
    const s = seed("thread");
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());
    const [, , subject1, , opts1] = SEND_EMAIL.mock.calls[0];
    expect(subject1).toBe("Hello Ada");
    expect(opts1.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.linki\.test\/api\/u\/[^>]+>, <mailto:reply-thread@sender\.test\?subject=unsubscribe>$/);
    expect(opts1.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(opts1.headers["In-Reply-To"]).toBeUndefined();

    // Clear the pacing gap, then run the follow-up.
    getDb().prepare("UPDATE sent_messages SET accepted_at = datetime('now', '-2 hours') WHERE email_account_id = ?").run(s.mail);
    makeDue(s.track);
    await emailCampaignTick(getDb());
    expect(SEND_EMAIL).toHaveBeenCalledTimes(2);
    const [, , subject2, body2, opts2] = SEND_EMAIL.mock.calls[1];
    expect(subject2).toBe("Re: Hello Ada");
    expect(body2).toContain("Just bumping this, Ada.");
    expect(opts2.headers["In-Reply-To"]).toBe(opts1.messageId);
    expect(opts2.headers.References).toBe(opts1.messageId);
  });

  it("threads an AI-written follow-up (approved agent draft) under the first subject", async () => {
    const s = seed("aidraft");
    getDb().pragma("foreign_keys = OFF");
    getDb().prepare("INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, subject, body, step_id, status, decided_at) VALUES ('aq-aidraft', ?, 'ag-x', 'tgt-aidraft', 'email', 'A brand new subject', 'Following up, Ada.', 's2-aidraft', 'approved', datetime('now'))").run(WS);
    getDb().pragma("foreign_keys = ON");
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());
    getDb().prepare("UPDATE sent_messages SET accepted_at = datetime('now', '-2 hours') WHERE email_account_id = ?").run(s.mail);
    makeDue(s.track);
    await emailCampaignTick(getDb());
    const [, , subject2, body2] = SEND_EMAIL.mock.calls[1];
    expect(body2).toContain("Following up, Ada.");
    expect(subject2).toBe("Re: Hello Ada");
  });

  it("keeps an explicit follow-up subject but still sets the threading headers", async () => {
    const s = seed("explicit", { followupSubject: "One more idea" });
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());
    getDb().prepare("UPDATE sent_messages SET accepted_at = datetime('now', '-2 hours') WHERE email_account_id = ?").run(s.mail);
    makeDue(s.track);
    await emailCampaignTick(getDb());
    const [, , subject2, , opts2] = SEND_EMAIL.mock.calls[1];
    expect(subject2).toBe("One more idea");
    expect(opts2.headers["In-Reply-To"]).toBe(SEND_EMAIL.mock.calls[0][4].messageId);
  });

  it("fills {{unsubscribe_url}} when a template asks for a footer link", async () => {
    seed("footer", { bodyTemplate: "Hi {{first_name}}.\n\nNot interested? {{unsubscribe_url}}" });
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());
    expect(SEND_EMAIL.mock.calls[0][3]).toMatch(/Not interested\? https:\/\/app\.linki\.test\/api\/u\/\S+/);
  });

  it("blocks the send when a template variable cannot be resolved", async () => {
    const s = seed("unresolved", { bodyTemplate: "Hi {{frist_name}}, quick question." });
    SEND_EMAIL.mockImplementation(accepted);
    await emailCampaignTick(getDb());
    expect(SEND_EMAIL).not.toHaveBeenCalled();
    const t = track(s.track);
    expect(t.state).toBe("failed");
    expect(t.error_message).toContain("{{frist_name}}");
  });
});
