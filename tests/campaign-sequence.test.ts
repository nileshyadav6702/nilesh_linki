import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";
import { createAgent } from "@/lib/agents/store";
import { draftableSteps, sequenceSteps } from "@/lib/agents/drafts";
import { blankStep, restructure, timeline, withPositions } from "@/components/agents/campaign/sequence";
import type { CampaignStep } from "@/components/agents/campaign/kit";

/** The Campaign tab's merged timeline and the structural edits it saves. */

const WS = "00000000-0000-4000-8000-000000000001";
let n = 0;
const step = (track: "linkedin" | "email", step_type: string, delay = 0): CampaignStep => ({
  id: `s${++n}`, track, step_type, step_order: 0, delay_seconds: delay, connect_note: null, message_body: null,
  email_subject: null, email_body: null, ai_enabled: 0, send_mode: "ai", message_position: 1, email_position: 1,
});
const DAY = 86_400;

describe("timeline", () => {
  it("merges both tracks by when each step runs and folds waits into the next step", () => {
    const steps = [
      step("linkedin", "connect"), step("linkedin", "delay", 3 * DAY), step("linkedin", "message"),
      step("email", "delay", 2 * DAY), step("email", "email"),
    ];
    const t = timeline(steps);
    expect(t.map((x) => x.step.step_type)).toEqual(["connect", "email", "message"]);
    expect(t.map((x) => x.delayBefore)).toEqual([null, 2 * DAY, 3 * DAY]);
  });

  it("shows a visit right before an invitation as the invitation's option", () => {
    const t = timeline([step("linkedin", "visit"), step("linkedin", "connect"), step("linkedin", "visit")]);
    expect(t.map((x) => [x.step.step_type, x.visitBefore])).toEqual([["connect", true], ["visit", false]]);
  });
});

describe("restructure", () => {
  it("replaces the waits before a step with one wait of the new length", () => {
    const steps = [step("linkedin", "connect"), step("linkedin", "delay", DAY), step("linkedin", "delay", DAY), step("linkedin", "message")];
    const msg = steps[3].id;
    const out = restructure(steps, msg, { delaySeconds: 5 * DAY });
    expect(out.map((s) => [s.step_type, s.delay_seconds])).toEqual([["connect", 0], ["delay", 5 * DAY], ["message", 0]]);
    expect(out[1].id).toBe(steps[1].id);
  });

  it("inserts a wait when there was none, and leaves the other track alone", () => {
    const steps = [step("linkedin", "connect"), step("linkedin", "message"), step("email", "email")];
    const out = restructure(steps, steps[1].id, { delaySeconds: 3600 });
    expect(out.filter((s) => s.track === "linkedin").map((s) => s.step_type)).toEqual(["connect", "delay", "message"]);
    expect(out.find((s) => s.track === "email")?.id).toBe(steps[2].id);
  });

  it("adds and removes the visit-before-invite step and merges field edits", () => {
    const steps = [step("linkedin", "connect"), step("linkedin", "message")];
    const on = restructure(steps, steps[0].id, { visitBefore: true, fields: { connect_note: "Hi {{first_name}}" } });
    expect(on.map((s) => s.step_type)).toEqual(["visit", "connect", "message"]);
    expect(on[1].connect_note).toBe("Hi {{first_name}}");
    expect(restructure(on, steps[0].id, { visitBefore: false }).map((s) => s.step_type)).toEqual(["connect", "message"]);
  });
});

describe("new step types", () => {
  it("treat like_posts and voice as ordinary LinkedIn steps with their own defaults", () => {
    expect(blankStep("linkedin", "like_posts").like_count).toBe(1);
    expect(blankStep("linkedin", "connect")).toMatchObject({ skip_after_days: 7, withdraw_after_days: 30 });
    const steps = [step("linkedin", "connect"), step("linkedin", "delay", DAY), step("linkedin", "like_posts"), step("linkedin", "delay", 2 * DAY), step("linkedin", "voice")];
    const t = timeline(steps);
    expect(t.map((x) => [x.step.step_type, x.delayBefore])).toEqual([["connect", null], ["like_posts", DAY], ["voice", 2 * DAY]]);
    const out = restructure(steps, steps[4].id, { delaySeconds: 3 * DAY, fields: { voice_duration_ms: 1000 } });
    expect(out.map((s) => [s.step_type, s.delay_seconds])).toEqual([["connect", 0], ["delay", DAY], ["like_posts", 0], ["delay", 3 * DAY], ["voice", 0]]);
  });
});

describe("withPositions", () => {
  it("numbers messages and emails per track in order", () => {
    const out = withPositions([step("linkedin", "message"), step("linkedin", "delay"), step("linkedin", "message"), step("email", "email"), step("email", "email")]);
    expect(out.map((s) => s.step_type === "email" ? s.email_position : s.message_position)).toEqual([1, 1, 2, 1, 2]);
  });
});

describe("same message for everyone", () => {
  it("is not drafted per lead by the agent", () => {
    const db = getDb();
    const workflowId = createDefaultCampaign(db, WS, "Fixed text", "linkedin");
    const agent = createAgent(WS, { name: "Fixed", workflow_id: workflowId, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
    db.prepare("UPDATE agents SET linkedin_account_id = (SELECT id FROM accounts LIMIT 1) WHERE id = ?").run(agent.id);
    const withAccount = { ...agent, linkedin_account_id: (db.prepare("SELECT linkedin_account_id FROM agents WHERE id = ?").get(agent.id) as { linkedin_account_id: string | null }).linkedin_account_id ?? "acc" };
    const lead = { linkedin_url: "https://www.linkedin.com/in/x", email: null };
    const before = draftableSteps(db, withAccount, lead).length;
    const first = sequenceSteps(db, workflowId).find((s) => s.channel === "linkedin_message")!;
    db.prepare("UPDATE workflow_steps SET send_mode = 'fixed', message_body = 'Hi {{first_name}}' WHERE id = ?").run(first.id);
    const after = draftableSteps(db, withAccount, lead);
    expect(after.length).toBe(before - 1);
    expect(after.some((s) => s.id === first.id)).toBe(false);
  });
});
