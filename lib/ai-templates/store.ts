import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * AI outreach templates: the structure, wording and instructions the AI writer follows for one
 * channel (LinkedIn / email) and one place in the sequence (icebreaker / follow-up / closing).
 * Text holds tokens like {{FirstName}}, {{AI:Reference their role}} and {{CTA}}.
 * A workspace either writes with Kairo's default (mode "default") or with its own templates
 * wherever one matches the step (mode "custom").
 */

export const CHANNELS = ["linkedin", "email"] as const;
export const KINDS = ["icebreaker", "followup", "closing"] as const;
export type Channel = (typeof CHANNELS)[number];
export type Kind = (typeof KINDS)[number];

export const VARIABLE_GROUPS = [
  { group: "Lead data", tone: "lead", items: ["FirstName", "LastName", "Company", "JobTitle"] },
  { group: "Sender data", tone: "sender", items: ["SenderFirstName", "SenderName", "SenderFullName", "SenderCompany"] },
  { group: "Signals", tone: "signal", items: ["Intent"] },
  { group: "AI blocks", tone: "ai", items: ["AI:Mention Recent Activity", "AI:Reference their role", "AI:Personalize with company context"] },
  { group: "CTA", tone: "cta", items: ["CTA"] },
] as const;
export const ALL_TOKENS: string[] = VARIABLE_GROUPS.flatMap((g) => [...g.items]);

export const LIMITS = { name: 60, linkedinBody: 700, emailBody: 3000, subject: 200, instructions: 1000 } as const;

export interface AiTemplate {
  id: string; workspace_id: string; name: string; channel: Channel; kind: Kind;
  subject: string | null; body: string; ai_instructions: string | null; created_at: string; updated_at: string;
}

/** Visible length: tokens count as their label, HTML tags (email) don't count. */
export function visibleLength(text: string): number {
  return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\{\{(?:AI:)?([^}]+)\}\}/g, "$1").length;
}

export const templateInput = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(LIMITS.name),
  channel: z.enum(CHANNELS),
  kind: z.enum(KINDS),
  subject: z.string().max(LIMITS.subject).nullable().optional(),
  body: z.string().max(20_000),
  ai_instructions: z.string().nullable().optional(),
}).superRefine((t, ctx) => {
  const max = t.channel === "email" ? LIMITS.emailBody : LIMITS.linkedinBody;
  if (visibleLength(t.body.trim()) === 0) ctx.addIssue({ code: "custom", path: ["body"], message: "Write the message template" });
  if (visibleLength(t.body) > max) ctx.addIssue({ code: "custom", path: ["body"], message: `Keep the message under ${max} characters` });
  if ((t.ai_instructions ?? "").length > LIMITS.instructions) ctx.addIssue({ code: "custom", path: ["ai_instructions"], message: `AI instructions are limited to ${LIMITS.instructions} characters` });
  if (t.channel === "email" && !(t.subject ?? "").trim()) ctx.addIssue({ code: "custom", path: ["subject"], message: "Add a subject line" });
  const unknown = [...`${t.subject ?? ""} ${t.body} ${t.ai_instructions ?? ""}`.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).filter((x) => !ALL_TOKENS.includes(x));
  if (unknown.length) ctx.addIssue({ code: "custom", path: ["body"], message: `Unknown variable: ${unknown[0]}` });
});
export type TemplateInput = z.infer<typeof templateInput>;

export function listTemplates(db: Database.Database, ws: string): AiTemplate[] {
  return db.prepare("SELECT * FROM ai_templates WHERE workspace_id = ? ORDER BY updated_at DESC").all(ws) as AiTemplate[];
}
export function getTemplate(db: Database.Database, ws: string, id: string): AiTemplate | null {
  return (db.prepare("SELECT * FROM ai_templates WHERE id = ? AND workspace_id = ?").get(id, ws) as AiTemplate | undefined) ?? null;
}
export function createTemplate(db: Database.Database, ws: string, t: TemplateInput): AiTemplate {
  const id = randomUUID();
  db.prepare("INSERT INTO ai_templates (id, workspace_id, name, channel, kind, subject, body, ai_instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, ws, t.name, t.channel, t.kind, t.channel === "email" ? t.subject ?? null : null, t.body, t.ai_instructions?.trim() || null);
  return getTemplate(db, ws, id)!;
}
export function updateTemplate(db: Database.Database, ws: string, id: string, t: TemplateInput): AiTemplate | null {
  const r = db.prepare(`UPDATE ai_templates SET name = ?, channel = ?, kind = ?, subject = ?, body = ?, ai_instructions = ?, updated_at = datetime('now')
    WHERE id = ? AND workspace_id = ?`).run(t.name, t.channel, t.kind, t.channel === "email" ? t.subject ?? null : null, t.body, t.ai_instructions?.trim() || null, id, ws);
  return r.changes ? getTemplate(db, ws, id) : null;
}
export function deleteTemplate(db: Database.Database, ws: string, id: string): boolean {
  return db.prepare("DELETE FROM ai_templates WHERE id = ? AND workspace_id = ?").run(id, ws).changes > 0;
}

const modeKey = (ws: string) => `ai_template_mode:${ws}`;
export type Mode = "default" | "custom";
export function getMode(db: Database.Database, ws: string): Mode {
  return (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(modeKey(ws)) as { value: string } | undefined)?.value === "custom" ? "custom" : "default";
}
export function setMode(db: Database.Database, ws: string, mode: Mode) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(modeKey(ws), mode);
}

/** Which kind of template a sequence step uses: first message, last of 3+, or anything between. */
export function kindForStep(position: number | null, totalOnTrack: number): Kind {
  if (position === 1 || position === null) return "icebreaker";
  if (position === totalOnTrack && totalOnTrack > 2) return "closing";
  return "followup";
}

/** The template the writer follows for a step: newest matching one, only in "custom" mode. */
export function templateFor(db: Database.Database, ws: string, channel: Channel, kind: Kind): AiTemplate | null {
  if (getMode(db, ws) !== "custom") return null;
  return (db.prepare("SELECT * FROM ai_templates WHERE workspace_id = ? AND channel = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1").get(ws, channel, kind) as AiTemplate | undefined) ?? null;
}

/**
 * Agents whose campaign would use each template right now: the template must be the one picked
 * for its channel + kind (newest) and an agent must have a message step of that channel and kind.
 */
export function templateUsage(db: Database.Database, ws: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (getMode(db, ws) !== "custom") return out;
  const picked = new Map<string, string>();
  for (const t of listTemplates(db, ws)) { const k = `${t.channel}:${t.kind}`; if (!picked.has(k)) picked.set(k, t.id); }
  const agents = db.prepare("SELECT id, workflow_id FROM agents WHERE workspace_id = ? AND workflow_id IS NOT NULL").all(ws) as Array<{ id: string; workflow_id: string }>;
  for (const a of agents) {
    const steps = db.prepare("SELECT track, step_type FROM workflow_steps WHERE workflow_id = ? AND COALESCE(enabled, 1) = 1 AND step_type IN ('message','email') ORDER BY track, step_order").all(a.workflow_id) as Array<{ track: string; step_type: string }>;
    const kinds = new Set<string>();
    for (const ch of CHANNELS) {
      const own = steps.filter((s) => (ch === "email" ? s.step_type === "email" : s.step_type === "message"));
      own.forEach((_, i) => kinds.add(`${ch}:${kindForStep(i + 1, own.length)}`));
    }
    for (const k of kinds) { const id = picked.get(k); if (id) out[id] = (out[id] ?? 0) + 1; }
  }
  return out;
}

/** "{{AI:Reference their role}}" → "[AI: Reference their role]" etc. — how tokens read in AI prompts. */
export function tokensForPrompt(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ")
    .replace(/\{\{AI:([^}]+)\}\}/g, "[AI block: $1]").replace(/\{\{CTA\}\}/g, "[CTA]").replace(/\{\{([^}]+)\}\}/g, "[$1]").trim();
}
