import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

const DAY = 86_400;

interface StepSpec {
  track: "linkedin" | "email"; type: "visit" | "connect" | "message" | "delay" | "email";
  delay?: number; body?: string; subject?: string; position?: number; ai?: string;
}

export type CampaignChannel = "linkedin" | "multi" | "email";

/** The step plan for a channel choice. LinkedIn and email run as parallel tracks. */
export function campaignPlan(channel: CampaignChannel): StepSpec[] {
  const linkedin: StepSpec[] = [
    { track: "linkedin", type: "connect" },
    { track: "linkedin", type: "delay", delay: 1 * DAY },
    { track: "linkedin", type: "message", position: 1, body: "Hi {{first_name}}, thanks for connecting — curious how you're approaching this at {{company}}?", ai: "AI icebreaker: open on the lead's signal; one question." },
    { track: "linkedin", type: "delay", delay: 3 * DAY },
    { track: "linkedin", type: "visit" },
    { track: "linkedin", type: "message", position: 2, body: "Hi {{first_name}}, just bumping this in case it got buried.", ai: "AI follow-up: a short follow-up with one new angle; no pressure." },
    { track: "linkedin", type: "delay", delay: 4 * DAY },
    { track: "linkedin", type: "message", position: 3, body: "Hi {{first_name}}, I'll leave it here — happy to reconnect whenever it's useful.", ai: "AI closing: a polite last note that makes it easy to say no." },
  ];
  const email: StepSpec[] = [
    { track: "email", type: "delay", delay: (channel === "multi" ? 2 : 0) * DAY },
    { track: "email", type: "email", position: 1, subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\n\nCurious how {{company}} is handling this today — worth a quick chat?", ai: "AI icebreaker email: open on the lead's signal." },
    { track: "email", type: "delay", delay: 3 * DAY },
    { track: "email", type: "email", position: 2, subject: "Re: Quick question, {{first_name}}", body: "Hi {{first_name}}, following up on my note below.", ai: "AI follow-up email: one new, concrete reason to talk." },
  ];
  return channel === "linkedin" ? linkedin : channel === "email" ? email.filter((s, i) => i > 0) : [...linkedin, ...email];
}

/**
 * A ready-made campaign for an AI agent. The message/email bodies are fallbacks only: the
 * agent drafts every step per lead in Copilot, and approved drafts replace them at send time.
 */
export function createDefaultCampaign(db: Database.Database, workspaceId: string, name: string, channel: CampaignChannel): string {
  const workflowId = randomUUID();
  const steps = campaignPlan(channel);
  const insert = db.prepare(`INSERT INTO workflow_steps (id, workflow_id, step_order, track, step_type, delay_seconds, message_body, email_subject, email_body,
      email_position, message_position, ai_enabled, ai_prompt, ai_max_words)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare("INSERT INTO workflows (id, workspace_id, name, description) VALUES (?, ?, ?, ?)")
      .run(workflowId, workspaceId, name, "Created by an AI agent: every message is drafted per lead and reviewed in Copilot");
    const order = { linkedin: 0, email: 0 };
    for (const s of steps) {
      order[s.track]++;
      const isEmail = s.type === "email";
      // Only follow-ups fall back to the AI writer; first touches always come from Copilot.
      const aiFallback = !!s.ai && (s.position ?? 1) > 1;
      insert.run(randomUUID(), workflowId, order[s.track], s.track, s.type, s.delay ?? 0,
        isEmail ? null : s.body ?? null, isEmail ? s.subject ?? null : null, isEmail ? s.body ?? null : null,
        isEmail ? s.position ?? 1 : 1, s.type === "message" ? s.position ?? 1 : 1, aiFallback ? 1 : 0, aiFallback ? s.ai! : null, aiFallback ? 80 : null);
    }
  })();
  return workflowId;
}
