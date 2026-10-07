import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

const DAY = 86_400;

interface StepSpec {
  track: "linkedin" | "email"; type: "visit" | "connect" | "message" | "delay" | "email";
  delay?: number; body?: string; subject?: string; position?: number; ai?: string;
}

/**
 * A ready-made campaign for an AI agent. The first message / email is a fallback only:
 * the agent's approved, signal-aware draft replaces it at send time. Follow-ups are
 * AI-written (when a model is configured) and stop automatically when the lead replies.
 */
export function createDefaultCampaign(db: Database.Database, workspaceId: string, name: string, withEmail: boolean): string {
  const workflowId = randomUUID();
  const steps: StepSpec[] = [
    { track: "linkedin", type: "visit" },
    { track: "linkedin", type: "connect" },
    { track: "linkedin", type: "message", position: 1, body: "Hi {{first_name}}, thanks for connecting — curious how you're approaching this at {{company}}?" },
    { track: "linkedin", type: "delay", delay: 4 * DAY },
    { track: "linkedin", type: "message", position: 2, body: "Hi {{first_name}}, just bumping this in case it got buried.", ai: "Write a short, friendly follow-up (under 45 words) to the previous LinkedIn message. Add one new angle; no pressure." },
  ];
  if (withEmail) {
    steps.push(
      { track: "email", type: "email", position: 1, subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\n\nCurious how {{company}} is handling outbound today — worth a quick chat?" },
      { track: "email", type: "delay", delay: 3 * DAY },
      { track: "email", type: "email", position: 2, subject: "Re: Quick question, {{first_name}}", body: "Hi {{first_name}}, following up on my note below.", ai: "Write a brief follow-up (under 70 words) to the previous email with one new, concrete reason to talk." },
    );
  }
  const insert = db.prepare(`INSERT INTO workflow_steps (id, workflow_id, step_order, track, step_type, delay_seconds, message_body, email_subject, email_body,
      email_position, message_position, ai_enabled, ai_prompt, ai_max_words)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare("INSERT INTO workflows (id, workspace_id, name, description) VALUES (?, ?, ?, ?)")
      .run(workflowId, workspaceId, name, "Created by an AI agent: connect + signal-aware first touch + AI follow-ups");
    const order = { linkedin: 0, email: 0 };
    for (const s of steps) {
      order[s.track]++;
      const isEmail = s.type === "email";
      insert.run(randomUUID(), workflowId, order[s.track], s.track, s.type, s.delay ?? 0,
        isEmail ? null : s.body ?? null, isEmail ? s.subject ?? null : null, isEmail ? s.body ?? null : null,
        isEmail ? s.position ?? 1 : 1, s.type === "message" ? s.position ?? 1 : 1, s.ai ? 1 : 0, s.ai ?? null, s.ai ? 80 : null);
    }
  })();
  return workflowId;
}
