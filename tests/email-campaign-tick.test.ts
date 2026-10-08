import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { emailCampaignRuns, emailCampaignTick, linkedInCampaignRuns } from "@/lib/linkedin/runner";

/**
 * Email steps must move when LinkedIn cannot. The LinkedIn loop only sees an
 * authenticated session; the email loop sees any open email track.
 */

const WS = "ws-email-tick";

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Email tick", "email-tick");
});

function seed(opts: {
  id: string;
  linkedin?: { authenticated: boolean } | null;
  emailAccount?: boolean;
  emailTrack?: "pending" | "in_progress";
  linkedinTrack?: "pending" | "in_progress";
  emailStep?: "delay" | "email";
  replied?: boolean;
}) {
  const db = getDb();
  const workflowId = `wf-${opts.id}`;
  const targetId = `tgt-${opts.id}`;
  const runId = `run-${opts.id}`;
  const profileId = `rp-${opts.id}`;
  let accountId: string | null = null;
  let emailAccountId: string | null = null;

  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(workflowId, opts.id, WS);
  if (opts.emailStep) {
    db.prepare(
      "INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, delay_seconds, email_subject, email_body) VALUES (?, ?, 1, ?, 'email', ?, ?, ?)"
    ).run(
      `step-${opts.id}`,
      workflowId,
      opts.emailStep,
      opts.emailStep === "delay" ? 0 : 0,
      opts.emailStep === "email" ? "Hello" : null,
      opts.emailStep === "email" ? "Body" : null,
    );
  }
  if (opts.linkedin) {
    accountId = `acct-${opts.id}`;
    db.prepare(
      "INSERT INTO accounts (id, name, email, workspace_id, is_authenticated) VALUES (?, ?, ?, ?, ?)"
    ).run(accountId, opts.id, `${opts.id}@li.test`, WS, opts.linkedin.authenticated ? 1 : 0);
  }
  if (opts.emailAccount) {
    emailAccountId = `mail-${opts.id}`;
    db.prepare(
      `INSERT INTO email_accounts (
        id, name, from_email, smtp_host, username, password, workspace_id,
        daily_email_limit, active_hours_start, active_hours_end, timezone, working_days
      ) VALUES (?, ?, ?, 'smtp.test', 'u', 'p', ?, 50, 0, 23, 'UTC', '7')`
    ).run(emailAccountId, opts.id, `${opts.id}@mail.test`, WS);
  }
  db.prepare(
    "INSERT INTO targets (id, linkedin_url, full_name, email, workspace_id, email_replied_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    targetId,
    `https://www.linkedin.com/in/${opts.id}`,
    opts.id,
    "ada@example.com",
    WS,
    opts.replied ? new Date().toISOString() : null,
  );
  db.prepare(
    "INSERT INTO runs (id, workspace_id, workflow_id, account_id, email_account_id, status) VALUES (?, ?, ?, ?, ?, 'running')"
  ).run(runId, WS, workflowId, accountId, emailAccountId);
  db.prepare(
    "INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)"
  ).run(profileId, runId, targetId, emailAccountId);
  if (opts.emailTrack) {
    db.prepare(
      "INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES (?, ?, 'email', ?, 0, NULL)"
    ).run(`et-${opts.id}`, profileId, opts.emailTrack);
  }
  if (opts.linkedinTrack) {
    db.prepare(
      "INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', ?, 0)"
    ).run(`lt-${opts.id}`, profileId, opts.linkedinTrack);
  }
  return { runId, profileId };
}

describe("campaign run selection", () => {
  it("drives an email-only run from the email loop and not the LinkedIn loop", () => {
    const { runId } = seed({ id: "email-only", emailTrack: "in_progress", emailStep: "delay" });
    expect(emailCampaignRuns(getDb()).map((run) => run.run_id)).toContain(runId);
    expect(linkedInCampaignRuns(getDb()).map((run) => run.run_id)).not.toContain(runId);
  });

  it("keeps a logged-out LinkedIn session out of the LinkedIn loop while email stays due", () => {
    const { runId } = seed({
      id: "logged-out",
      linkedin: { authenticated: false },
      emailTrack: "in_progress",
      emailStep: "delay",
    });
    expect(emailCampaignRuns(getDb()).map((run) => run.run_id)).toContain(runId);
    expect(linkedInCampaignRuns(getDb()).map((run) => run.run_id)).not.toContain(runId);
  });

  it("shows a live LinkedIn session to both loops when an email track is still open", () => {
    const { runId } = seed({
      id: "both",
      linkedin: { authenticated: true },
      emailTrack: "pending",
      linkedinTrack: "pending",
      emailStep: "email",
    });
    expect(emailCampaignRuns(getDb()).map((run) => run.run_id)).toContain(runId);
    expect(linkedInCampaignRuns(getDb()).map((run) => run.run_id)).toContain(runId);
  });

  it("leaves a LinkedIn-only run off the email loop", () => {
    const { runId } = seed({
      id: "li-only",
      linkedin: { authenticated: true },
      linkedinTrack: "in_progress",
    });
    expect(emailCampaignRuns(getDb()).map((run) => run.run_id)).not.toContain(runId);
    expect(linkedInCampaignRuns(getDb()).map((run) => run.run_id)).toContain(runId);
  });
});

describe("emailCampaignTick", () => {
  it("finishes a due email delay and closes an email-only run without a LinkedIn account", async () => {
    const { runId } = seed({ id: "finish", emailTrack: "in_progress", emailStep: "delay" });
    await emailCampaignTick(getDb());
    const track = getDb().prepare(
      "SELECT state FROM run_profile_tracks WHERE id = ?"
    ).get("et-finish") as { state: string };
    const run = getDb().prepare("SELECT status, last_tick_at FROM runs WHERE id = ?").get(runId) as { status: string; last_tick_at: string | null };
    expect(track.state).toBe("completed");
    expect(run.status).toBe("completed");
    expect(run.last_tick_at).toBeTruthy();
  });

  it("does not advance the LinkedIn track while it runs the email track", async () => {
    seed({
      id: "split",
      linkedin: { authenticated: false },
      emailTrack: "in_progress",
      linkedinTrack: "pending",
      emailStep: "delay",
    });
    await emailCampaignTick(getDb());
    const email = getDb().prepare("SELECT state FROM run_profile_tracks WHERE id = ?").get("et-split") as { state: string };
    const linkedin = getDb().prepare("SELECT state FROM run_profile_tracks WHERE id = ?").get("lt-split") as { state: string };
    expect(email.state).toBe("completed");
    expect(linkedin.state).toBe("pending");
  });

  it("enrolls a pending email track while LinkedIn is logged out, and does not send", async () => {
    seed({
      id: "enroll",
      linkedin: { authenticated: false },
      emailAccount: true,
      emailTrack: "pending",
      emailStep: "email",
    });
    await emailCampaignTick(getDb());
    const track = getDb().prepare(
      "SELECT state, next_step_at FROM run_profile_tracks WHERE id = ?"
    ).get("et-enroll") as { state: string; next_step_at: string | null };
    const sent = getDb().prepare(
      "SELECT COUNT(*) as c FROM logs WHERE message LIKE 'Email sent%'"
    ).get() as { c: number };
    expect(track.state).toBe("in_progress");
    expect(track.next_step_at).toBeTruthy();
    expect(sent.c).toBe(0);
  });

  it("stops both tracks when the lead has already replied", async () => {
    const { runId } = seed({
      id: "replied",
      emailTrack: "in_progress",
      linkedinTrack: "in_progress",
      emailStep: "delay",
      replied: true,
    });
    await emailCampaignTick(getDb());
    const states = getDb().prepare(
      "SELECT track, state FROM run_profile_tracks WHERE run_profile_id = ? ORDER BY track"
    ).all("rp-replied") as Array<{ track: string; state: string }>;
    expect(states).toEqual([
      { track: "email", state: "skipped" },
      { track: "linkedin", state: "skipped" },
    ]);
    const run = getDb().prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    expect(run.status).toBe("completed");
  });
});
