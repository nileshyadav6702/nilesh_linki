import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";

vi.mock("@/lib/linkedin/session", async (orig) => ({ ...(await orig<typeof import("@/lib/linkedin/session")>()), markNeedsReauth: vi.fn(async () => {}) }));

import { getDb } from "@/lib/db";
import { handleStepError } from "@/lib/linkedin/campaign/steps";
import { WeeklyLimitError } from "@/lib/linkedin/connect";
import { assertSignedIn, SessionExpiredError } from "@/lib/linkedin/session-guard";
import { markNeedsReauth } from "@/lib/linkedin/session";
import type { Target, TrackRun, WorkflowStep } from "@/lib/linkedin/campaign/types";

const WS = "ws-step-errors";
let n = 0;
function track() {
  const db = getDb();
  n++;
  db.prepare("INSERT INTO targets (id, workspace_id, full_name) VALUES (?, ?, 'Lead')").run(`se-t-${n}`, WS);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, 'se-run', ?)").run(`se-rp-${n}`, `se-t-${n}`);
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', 0)").run(`se-tr-${n}`, `se-rp-${n}`);
  const tr = { ...(db.prepare("SELECT * FROM run_profile_tracks WHERE id = ?").get(`se-tr-${n}`) as TrackRun), account_id: "se-acc" } as TrackRun;
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(`se-t-${n}`) as Target;
  return { tr, target };
}
const row = (id: string) => getDb().prepare("SELECT state, retry_count, next_step_at FROM run_profile_tracks WHERE id = ?").get(id) as { state: string; retry_count: number; next_step_at: string | null };
const steps = [{ id: "s1", step_type: "message" }] as unknown as WorkflowStep[];

let browser: Browser;
beforeAll(async () => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, timezone) VALUES ('se-acc', ?, 'Me', 'me@se.io', 1, 'UTC')").run(WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('se-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, account_id, status) VALUES ('se-run', ?, 'se-wf', 'se-acc', 'running')").run(WS);
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => { await browser?.close(); });

describe("step errors", () => {
  it("retries an unexpected error 3 times (1h, 2h, 4h), then fails the lead", () => {
    const { tr, target } = track();
    for (const hours of [1, 2, 4]) {
      handleStepError(getDb(), "se-run", tr, target, steps, "Lead", new Error("page.click: Timeout 8000ms exceeded"));
      const r = row(tr.id);
      expect(r.state).toBe("in_progress");
      expect(Math.round((Date.parse(r.next_step_at!) - Date.now()) / 3_600_000)).toBe(hours);
    }
    handleStepError(getDb(), "se-run", tr, target, steps, "Lead", new Error("page.click: Timeout 8000ms exceeded"));
    expect(row(tr.id).state).toBe("failed");
  });

  it("holds the lead and flags the account when LinkedIn signed the session out", () => {
    const { tr, target } = track();
    handleStepError(getDb(), "se-run", tr, target, steps, "Lead", new SessionExpiredError("https://www.linkedin.com/login"));
    expect(row(tr.id).state).toBe("in_progress");
    expect(markNeedsReauth).toHaveBeenCalledWith("se-acc");
  });

  it("LinkedIn's weekly limit blocks this account's invitations until next week, without pausing the run", () => {
    const { tr, target } = track();
    handleStepError(getDb(), "se-run", tr, target, steps, "Lead", new WeeklyLimitError("weekly limit"));
    const until = (getDb().prepare("SELECT connects_blocked_until b FROM accounts WHERE id = 'se-acc'").get() as { b: string }).b;
    expect(Date.parse(until)).toBeGreaterThan(Date.now());
    expect(row(tr.id).next_step_at).toBe(until);
    expect((getDb().prepare("SELECT status FROM runs WHERE id = 'se-run'").get() as { status: string }).status).toBe("running");
  });

  it("recognises a sign-in wall after navigation", async () => {
    const page = await browser.newPage();
    await page.route("https://www.linkedin.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<form action='/checkpoint/lg/login-submit'><input id='session_key'></form>" }));
    await page.goto("https://www.linkedin.com/login?session_redirect=x");
    await expect(assertSignedIn(page)).rejects.toBeInstanceOf(SessionExpiredError);
    await page.goto("https://www.linkedin.com/in/jane-doe");
    await expect(assertSignedIn(page)).rejects.toBeInstanceOf(SessionExpiredError); // same URL, sign-in form
    await page.route("https://www.linkedin.com/in/ok", (r) => r.fulfill({ contentType: "text/html", body: "<main>Jane</main>" }));
    await page.goto("https://www.linkedin.com/in/ok");
    await expect(assertSignedIn(page)).resolves.toBeUndefined();
    await page.close();
  }, 60_000);
});
