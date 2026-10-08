import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { emailCampaignTick } from "@/lib/linkedin/runner";
import { premium } from "@/lib/premium";
import { AiCreditError } from "@/lib/ai/client";

/**
 * A missing AI key or an out-of-credit/spend-cap error used to trAdvance the track: the step
 * was silently skipped and a sequence could "complete" having sent nothing. Now the step is
 * held (current_step unchanged, retried in hours) and any other writer error fails the step.
 */

const WS = "ws-ai-hold";

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "AI hold", "ai-hold");
});
afterEach(() => vi.restoreAllMocks());

function seed(id: string, opts: { withKey: boolean }) {
  const db = getDb();
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(`wf-${id}`, id, WS);
  db.prepare(`INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, ai_enabled, ai_model, ai_prompt)
    VALUES (?, ?, 1, 'email', 'email', 1, 'test/model', 'Write a short email')`).run(`step-${id}`, `wf-${id}`);
  db.prepare(`INSERT INTO email_accounts (id, name, from_email, smtp_host, username, password, workspace_id,
      daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, ramp_up_enabled)
    VALUES (?, ?, ?, 'smtp.test', 'u', 'p', ?, 50, 0, 24, 'UTC', '1,2,3,4,5,6,7', 0)`).run(`mail-${id}`, id, `${id}@mail.test`, WS);
  // Verified recently, so no SMTP probe runs before the AI writer.
  db.prepare(`INSERT INTO targets (id, linkedin_url, full_name, email, email_status, email_verified_at, workspace_id)
    VALUES (?, ?, ?, ?, 'verified', datetime('now'), ?)`).run(`tgt-${id}`, `https://www.linkedin.com/in/${id}`, id, `${id}@example.com`, WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, email_account_id, status) VALUES (?, ?, ?, ?, 'running')").run(`run-${id}`, WS, `wf-${id}`, `mail-${id}`);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)").run(`rp-${id}`, `run-${id}`, `tgt-${id}`, `mail-${id}`);
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at) VALUES (?, ?, 'email', 'in_progress', 0, NULL)").run(`et-${id}`, `rp-${id}`);
  if (opts.withKey) {
    db.prepare("INSERT OR REPLACE INTO integrations (key, workspace_id, api_key) VALUES ('openrouter', ?, 'sk-test')").run(WS);
  } else {
    db.prepare("DELETE FROM integrations WHERE key = 'openrouter' AND workspace_id = ?").run(WS);
  }
  return `et-${id}`;
}

const track = (id: string) => getDb().prepare("SELECT state, current_step, next_step_at, error_message FROM run_profile_tracks WHERE id = ?").get(id) as
  { state: string; current_step: number; next_step_at: string | null; error_message: string | null };
const hoursAhead = (iso: string | null) => (Date.parse(iso ?? "") - Date.now()) / 3_600_000;

describe("AI writing blocked on the user", () => {
  it("holds the step when the OpenRouter key is missing instead of skipping it", async () => {
    const id = seed("nokey", { withKey: false });
    await emailCampaignTick(getDb());
    const t = track(id);
    expect(t.state).toBe("in_progress");
    expect(t.current_step).toBe(0);
    expect(hoursAhead(t.next_step_at)).toBeGreaterThan(5);
    expect(t.error_message).toMatch(/AI writing blocked/);
  });

  it("holds the step on an out-of-credit error from the writer", async () => {
    const id = seed("credit", { withKey: true });
    const writer = vi.spyOn(premium.ai!, "writeEmail").mockRejectedValue(new AiCreditError());
    await emailCampaignTick(getDb());
    expect(writer).toHaveBeenCalled();
    const t = track(id);
    expect(t.state).toBe("in_progress");
    expect(t.current_step).toBe(0);
    expect(hoursAhead(t.next_step_at)).toBeGreaterThan(5);
    expect(t.error_message).toMatch(/out of credit/);
  });

  it("fails the step (never sends) on any other writer error", async () => {
    const id = seed("refusal", { withKey: true });
    vi.spyOn(premium.ai!, "writeEmail").mockRejectedValue(new Error("The selected model refused or broke character in the body"));
    await emailCampaignTick(getDb());
    const t = track(id);
    expect(t.state).toBe("failed");
    expect(getDb().prepare("SELECT COUNT(*) c FROM email_jobs WHERE target_id = 'tgt-refusal'").get()).toEqual({ c: 0 });
  });
});
