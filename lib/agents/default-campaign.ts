import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { campaignPlan, type CampaignChannel } from "@/lib/agents/campaign-plan";

export type { CampaignChannel };

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
