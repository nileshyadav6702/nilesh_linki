import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/linkedin/session", () => ({
  getSessionPage: vi.fn(async () => ({ close: async () => {} })), getSessionContext: vi.fn(async () => ({})),
  saveSessionState: vi.fn(async () => true), closeSession: vi.fn(async () => {}), dropStaleSession: vi.fn(), markNeedsReauth: vi.fn(async () => {}),
  browserUseCount: () => 0,
}));
vi.mock("@/lib/linkedin/campaign/pre-enrich", () => ({ ensureSalesNavEnriched: vi.fn(async () => {}) }));
const sends = vi.hoisted(() => ({ texts: [] as string[], failNext: true }));
vi.mock("@/lib/linkedin/message", async (orig) => ({
  ...(await orig<typeof import("@/lib/linkedin/message")>()),
  sendMessage: vi.fn(async (_page: unknown, _to: unknown, text: string) => {
    sends.texts.push(text);
    if (sends.failNext) { sends.failNext = false; throw new Error("Message composer did not open"); }
  }),
}));

import { getDb } from "@/lib/db";
import { premium } from "@/lib/premium";
import { executeStep } from "@/lib/linkedin/campaign/steps";
import type { AccountLimits, Target, TrackRun, WorkflowStep } from "@/lib/linkedin/campaign/types";

const WS = "ws-msg-retry";
const limits = { daily_connection_limit: 20, daily_message_limit: 50, daily_inmail_limit: 15, daily_visit_limit: 150, active_hours_start: 0, active_hours_end: 24, timezone: "UTC", working_days: "1,2,3,4,5,6,7" } as unknown as AccountLimits;

beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, timezone) VALUES ('mr-acc', ?, 'Me', 'mr@x.io', 1, 'UTC')").run(WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES ('mr-wf', 'W', ?)").run(WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, ai_enabled, ai_prompt) VALUES ('mr-ai', 'mr-wf', 1, 'message', 'linkedin', 1, 'Say hi')").run();
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, ai_enabled) VALUES ('mr-empty', 'mr-wf', 2, 'message', 'linkedin', 0)").run();
  db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, account_id, status) VALUES ('mr-run', ?, 'mr-wf', 'mr-acc', 'running')").run(WS);
});

function lead(id: string, step: number) {
  const db = getDb();
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, degree) VALUES (?, ?, 'Jane Doe', ?, 1)").run(id, WS, `https://www.linkedin.com/in/${id}`);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, 'mr-run', ?)").run(`rp-${id}`, id);
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', ?)").run(`tr-${id}`, `rp-${id}`, step);
}
const load = (id: string) => {
  const db = getDb();
  const tr = { ...(db.prepare("SELECT * FROM run_profile_tracks WHERE id = ?").get(`tr-${id}`) as TrackRun), run_id: "mr-run", target_id: id, account_id: "mr-acc", workflow_id: "mr-wf" } as TrackRun;
  return { tr, target: db.prepare("SELECT * FROM targets WHERE id = ?").get(id) as Target };
};
const steps = () => getDb().prepare("SELECT * FROM workflow_steps WHERE workflow_id = 'mr-wf' ORDER BY step_order").all() as WorkflowStep[];

describe("LinkedIn message retries", () => {
  it("a retry after a failed send sends the same AI message, without writing a new one", async () => {
    lead("mr-t1", 0);
    let n = 0;
    const writer = vi.spyOn(premium.ai!, "writeLinkedInMessage").mockImplementation(async () => ({ body: `Hi Jane, version ${++n}` }) as never);
    vi.spyOn(premium.ai!, "getContactWithCompany").mockReturnValue({ contact: {}, company: {} } as never);
    const first = load("mr-t1");
    await executeStep(getDb(), "mr-run", first.tr, first.target, steps(), "mr-acc", limits);
    expect(getDb().prepare("SELECT current_step, retry_count FROM run_profile_tracks WHERE id = 'tr-mr-t1'").get()).toEqual({ current_step: 0, retry_count: 1 });
    const again = load("mr-t1");
    await executeStep(getDb(), "mr-run", again.tr, again.target, steps(), "mr-acc", limits);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(sends.texts).toEqual(["Hi Jane, version 1", "Hi Jane, version 1"]);
    expect((getDb().prepare("SELECT current_step FROM run_profile_tracks WHERE id = 'tr-mr-t1'").get() as { current_step: number }).current_step).toBe(1);
  });

  it("a step with nothing to send holds the lead instead of skipping past it", async () => {
    lead("mr-t2", 1);
    const { tr, target } = load("mr-t2");
    await executeStep(getDb(), "mr-run", tr, target, steps(), "mr-acc", limits);
    const row = getDb().prepare("SELECT state, current_step, error_message FROM run_profile_tracks WHERE id = 'tr-mr-t2'").get() as { state: string; current_step: number; error_message: string };
    expect(row).toMatchObject({ state: "in_progress", current_step: 1 });
    expect(row.error_message).toMatch(/Nothing to send/);
  });
});

describe("invitation notes", () => {
  it("a note over 300 characters ends at a whole word", async () => {
    const { fitInvitationNote } = await import("@/lib/linkedin/campaign/steps/connect");
    const long = `${"word ".repeat(70)}tail`;
    const fitted = fitInvitationNote(long);
    expect(fitted.length).toBeLessThanOrEqual(300);
    expect(fitted.endsWith("word")).toBe(true);
    expect(fitInvitationNote("short note")).toBe("short note");
  });
});
