import { randomUUID } from "crypto";
import { tregEnabled } from "@/lib/treg/client";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { isSourceType, SOURCE_TYPES, type SourceType } from "@/lib/signals/types";

export interface Agent {
  id: string; workspace_id: string; name: string; icp_id: string | null;
  status: "draft" | "active" | "paused"; mode: "copilot" | "autopilot";
  min_score: number; fit_weight: number; workflow_id: string | null; list_id: string | null;
  linkedin_account_id: string | null; email_account_id: string | null;
  autopilot_delay_minutes: number; daily_lead_cap: number; enrich_emails: number;
  booking_url: string | null; last_run_at: string | null; last_error: string | null;
  reply_instructions?: string | null;
  outreach_enabled: number; goal: "conversations" | "meetings"; tone: "professional" | "conversational" | "direct";
  channel: "linkedin" | "multi" | "email"; exclude_first_degree: number;
  created_at: string; updated_at: string;
}

export interface AgentSource {
  id: string; agent_id: string; workspace_id: string; source_type: SourceType; config_json: string;
  enabled: number; interval_hours: number; last_run_at: string | null; next_run_at: string | null;
  cursor_json: string | null; last_error: string | null; created_at: string;
}

export const sourceConfigSchema = z.object({
  // 2000: a Warm Lookalike Sales Navigator search URL carries its filters.
  urls: z.array(z.string().trim().url().max(2000)).max(25).default([]),
  keywords: z.array(z.string().trim().min(2).max(80)).max(15).default([]),
  boards: z.array(z.object({ ats: z.enum(["greenhouse", "lever", "ashby"]), slug: z.string().trim().min(1).max(120), company: z.string().trim().max(160).optional() })).max(40).default([]),
  role_keywords: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  feeds: z.array(z.string().trim().url().max(400)).max(10).default([]),
  list_ids: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  posts_per_entity: z.number().int().min(1).max(10).default(3),
  max_engagers_per_post: z.number().int().min(5).max(100).default(40),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icp_id: z.string().max(100).nullish(),
  mode: z.enum(["copilot", "autopilot"]).default("copilot"),
  min_score: z.number().min(0).max(100).default(60),
  fit_weight: z.number().min(0).max(1).default(0.6),
  workflow_id: z.string().max(100).nullish(),
  linkedin_account_id: z.string().max(100).nullish(),
  email_account_id: z.string().max(100).nullish(),
  autopilot_delay_minutes: z.number().int().min(0).max(10080).default(60),
  daily_lead_cap: z.number().int().min(1).max(500).default(25),
  enrich_emails: z.boolean().default(true),
  booking_url: z.string().trim().url().max(400).nullish(),
  reply_instructions: z.string().trim().max(500).nullish(),
  goal: z.enum(["conversations", "meetings"]).default("conversations"),
  tone: z.enum(["professional", "conversational", "direct"]).default("professional"),
  channel: z.enum(["linkedin", "multi", "email"]).default("multi"),
  exclude_first_degree: z.boolean().default(true),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

/** Reject references to rows outside the workspace. Returns an error message or null. */
export function checkAgentRefs(workspaceId: string, input: Partial<AgentInput>): string | null {
  const db = getDb();
  const refs: Array<[string, string | null | undefined]> = [["icps", input.icp_id], ["workflows", input.workflow_id], ["accounts", input.linkedin_account_id], ["email_accounts", input.email_account_id]];
  for (const [table, id] of refs) {
    if (id && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId)) return `${table} reference does not belong to this workspace`;
  }
  return null;
}

export function getAgent(id: string, workspaceId: string): Agent | null {
  return (getDb().prepare("SELECT * FROM agents WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as Agent | undefined) ?? null;
}

export function listAgents(workspaceId: string): Agent[] {
  return getDb().prepare("SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId) as Agent[];
}

export function createAgent(workspaceId: string, input: AgentInput): Agent {
  const db = getDb();
  const id = randomUUID();
  const listId = randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO lists (id, workspace_id, name, description) VALUES (?, ?, ?, ?)")
      .run(listId, workspaceId, `Agent · ${input.name}`, "Leads found and qualified by this AI agent");
    db.prepare(`INSERT INTO agents (id, workspace_id, name, icp_id, mode, min_score, fit_weight, workflow_id, list_id, linkedin_account_id,
        email_account_id, autopilot_delay_minutes, daily_lead_cap, enrich_emails, booking_url, goal, tone, channel, exclude_first_degree)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, input.name, input.icp_id ?? null, input.mode, input.min_score, input.fit_weight, input.workflow_id ?? null, listId,
        input.linkedin_account_id ?? null, input.email_account_id ?? null, input.autopilot_delay_minutes, input.daily_lead_cap, input.enrich_emails ? 1 : 0, input.booking_url ?? null,
        input.goal ?? "conversations", input.tone ?? "professional", input.channel ?? "multi", input.exclude_first_degree === false ? 0 : 1);
  })();
  return getAgent(id, workspaceId)!;
}

const PATCHABLE = ["name", "icp_id", "mode", "min_score", "fit_weight", "workflow_id", "linkedin_account_id", "email_account_id", "autopilot_delay_minutes", "daily_lead_cap", "enrich_emails", "booking_url", "status", "goal", "tone", "channel", "exclude_first_degree", "outreach_enabled", "reply_instructions"] as const;

export function updateAgent(id: string, workspaceId: string, patch: Record<string, unknown>): Agent | null {
  const fields = PATCHABLE.filter((f) => patch[f] !== undefined);
  if (!fields.length) return getAgent(id, workspaceId);
  const values = fields.map((f) => (["enrich_emails", "exclude_first_degree", "outreach_enabled"].includes(f) ? (patch[f] ? 1 : 0) : patch[f] ?? null));
  getDb().prepare(`UPDATE agents SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`).run(...values, id, workspaceId);
  return getAgent(id, workspaceId);
}

export function deleteAgent(id: string, workspaceId: string): void {
  getDb().prepare("DELETE FROM agents WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
}

function cloneWorkflow(db: ReturnType<typeof getDb>, workspaceId: string, workflowId: string, name: string): string | null {
  const row = db.prepare("SELECT description, prompt FROM workflows WHERE id = ? AND workspace_id = ?").get(workflowId, workspaceId) as { description: string | null; prompt: string | null } | undefined;
  if (!row) return null;
  const id = randomUUID();
  db.prepare("INSERT INTO workflows (id, workspace_id, name, description, prompt) VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, name, row.description, row.prompt);
  const steps = db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ?").all(workflowId) as Array<Record<string, unknown>>;
  for (const step of steps) {
    const copy: Record<string, unknown> = { ...step, id: randomUUID(), workflow_id: id };
    const cols = Object.keys(copy);
    db.prepare(`INSERT INTO workflow_steps (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => copy[c]));
  }
  return id;
}

/** A new draft agent with the same ICP, sources, and steps. Leads stay on the original. */
export function duplicateAgent(id: string, workspaceId: string): Agent | null {
  const src = getAgent(id, workspaceId);
  if (!src) return null;
  const db = getDb();
  const copy = db.transaction(() => {
    let icpId = src.icp_id;
    if (icpId) {
      const icp = db.prepare("SELECT website_url, data_json FROM icps WHERE id = ? AND workspace_id = ?").get(icpId, workspaceId) as { website_url: string | null; data_json: string } | undefined;
      if (icp) {
        icpId = randomUUID();
        const version = ((db.prepare("SELECT MAX(version) v FROM icps WHERE workspace_id = ?").get(workspaceId) as { v: number | null }).v ?? 0) + 1;
        db.prepare("INSERT INTO icps (id, workspace_id, version, website_url, data_json) VALUES (?, ?, ?, ?, ?)").run(icpId, workspaceId, version, icp.website_url, icp.data_json);
      }
    }
    const workflowId = src.workflow_id ? cloneWorkflow(db, workspaceId, src.workflow_id, `${src.name} (copy)`) : null;
    const created = createAgent(workspaceId, {
      name: `${src.name} (copy)`.slice(0, 120),
      icp_id: icpId,
      mode: src.mode,
      min_score: src.min_score,
      fit_weight: src.fit_weight,
      workflow_id: workflowId,
      linkedin_account_id: src.linkedin_account_id,
      email_account_id: src.email_account_id,
      autopilot_delay_minutes: src.autopilot_delay_minutes,
      daily_lead_cap: src.daily_lead_cap,
      enrich_emails: !!src.enrich_emails,
      booking_url: src.booking_url,
      goal: src.goal,
      tone: src.tone,
      channel: src.channel,
      exclude_first_degree: !!src.exclude_first_degree,
    });
    for (const source of listSources(id, workspaceId)) addSource(created.id, workspaceId, source.source_type, parseSourceConfig(source.config_json), source.interval_hours);
    return created;
  })();
  return copy;
}

export function listSources(agentId: string, workspaceId: string): AgentSource[] {
  return getDb().prepare("SELECT * FROM agent_sources WHERE agent_id = ? AND workspace_id = ? ORDER BY created_at").all(agentId, workspaceId) as AgentSource[];
}

export function parseSourceConfig(json: string | null | undefined): SourceConfig {
  try { return sourceConfigSchema.parse(JSON.parse(json || "{}")); } catch { return sourceConfigSchema.parse({}); }
}

export function addSource(agentId: string, workspaceId: string, sourceType: string, config: unknown, intervalHours = 12): AgentSource {
  if (!isSourceType(sourceType)) throw new Error(`Unknown source type: ${sourceType}`);
  const parsed = sourceConfigSchema.parse(config ?? {});
  const id = randomUUID();
  getDb().prepare(`INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, config_json, interval_hours, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(id, agentId, workspaceId, sourceType, JSON.stringify(parsed), Math.min(168, Math.max(1, intervalHours)));
  return getDb().prepare("SELECT * FROM agent_sources WHERE id = ?").get(id) as AgentSource;
}

export function updateSource(id: string, workspaceId: string, patch: { config?: unknown; enabled?: boolean; interval_hours?: number }): AgentSource | null {
  const db = getDb();
  const src = db.prepare("SELECT * FROM agent_sources WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as AgentSource | undefined;
  if (!src) return null;
  if (patch.config !== undefined) db.prepare("UPDATE agent_sources SET config_json = ? WHERE id = ?").run(JSON.stringify(sourceConfigSchema.parse(patch.config)), id);
  if (patch.enabled !== undefined) db.prepare("UPDATE agent_sources SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
  if (patch.interval_hours !== undefined) db.prepare("UPDATE agent_sources SET interval_hours = ? WHERE id = ?").run(Math.min(168, Math.max(1, patch.interval_hours)), id);
  return db.prepare("SELECT * FROM agent_sources WHERE id = ?").get(id) as AgentSource;
}

export function deleteSource(id: string, workspaceId: string): void {
  getDb().prepare("DELETE FROM agent_sources WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
}

/** Sources treg can run without the agent's LinkedIn session (lib/treg). */
export const TREG_SOURCES: ReadonlySet<SourceType> = new Set<SourceType>(["competitor_engagement", "influencer_engagement", "own_content_engagement", "keyword_engagement", "job_change", "lookalike"]);

/** Whether a source must run through the agent's LinkedIn browser session. With treg configured, most do not. */
export function sourceNeedsLinkedIn(type: SourceType): boolean {
  return SOURCE_TYPES[type].needsLinkedIn && !(tregEnabled() && TREG_SOURCES.has(type));
}
