import { randomUUID } from "crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import { aiJson } from "@/lib/ai/client";
import type { Icp } from "@/lib/icp/schema";
import type { Agent } from "@/lib/agents/store";
import { workflowChannels, type Channel } from "@/lib/agents/enroll";

const draftSchema = z.object({
  subject: z.string().max(140).nullable().optional(),
  body: z.string().min(10).max(2000),
});

export interface StrongSignal { id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string }

export function strongestSignals(db: Database.Database, targetId: string, limit = 3): StrongSignal[] {
  return db.prepare(`SELECT id, type, title, snippet, source_url, occurred_at FROM signals WHERE target_id = ?
    ORDER BY COALESCE(weight, score) * (1.0 / (1 + (julianday('now') - julianday(occurred_at)) / 14)) DESC LIMIT ?`).all(targetId, limit) as StrongSignal[];
}

/** Channels to draft for a lead, given the agent's campaign and how the lead is reachable. */
export function draftChannels(db: Database.Database, agent: Agent, target: { linkedin_url: string | null; email: string | null }): Channel[] {
  const ch = workflowChannels(db, agent.workflow_id);
  const out: Channel[] = [];
  if (ch.linkedin && ch.firstLinkedinIsMessage && target.linkedin_url && agent.linkedin_account_id) out.push("linkedin_message");
  if (ch.email && target.email && agent.email_account_id) out.push("email");
  return out;
}

/** Writes a first touch that opens on the lead's real signal, using only supplied facts. */
export async function writeFirstTouch(agent: Agent, icp: Icp | null, channel: Channel, contact: Record<string, unknown>, company: Record<string, unknown> | null, signals: StrongSignal[]): Promise<{ subject: string | null; body: string }> {
  const r = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "first_touch",
    temperature: 0.6,
    instructions: [
      channel === "email"
        ? "Write a short cold email (60-110 words) with a plain, specific subject line of at most 7 words."
        : "Write a LinkedIn message (35-70 words), no subject, sent after they accepted a connection request.",
      "Open with the lead's most relevant signal from data.signals in a natural way (e.g. their comment or the post they engaged with). Never say you were tracking or monitoring them.",
      "Connect that signal to one pain point and one value prop from data.offer. Ask one low-friction question at the end.",
      "Use only facts present in data; never invent numbers, customers, events or relationships. No flattery, no hype, no emojis, no links.",
      "Address the lead by first name. Write in plain text, sounding like a thoughtful human founder.",
    ],
    data: {
      contact: { first_name: contact.first_name, full_name: contact.full_name, headline: contact.headline, title: contact.title, company: contact.company, location: contact.location, about: typeof contact.summary === "string" ? contact.summary.slice(0, 500) : null },
      company: company ? { name: company.name, industry: company.industry, description: typeof company.description === "string" ? company.description.slice(0, 300) : null } : null,
      signals: signals.map((s) => ({ what: s.title, detail: s.snippet, when: s.occurred_at })),
      offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props, pain_points: icp.pain_points } : null,
    },
    outputShape: channel === "email" ? `{"subject":"","body":""}` : `{"body":""}`,
    schema: draftSchema,
  });
  return { subject: channel === "email" ? (r.subject?.trim() || "Quick question") : null, body: r.body.trim() };
}

export function queueDraft(db: Database.Database, agent: Agent, targetId: string, channel: Channel, draft: { subject: string | null; body: string }, signalId: string | null): string {
  const id = randomUUID();
  const autoAt = agent.mode === "autopilot" ? new Date(Date.now() + agent.autopilot_delay_minutes * 60_000).toISOString() : null;
  db.prepare(`INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, subject, body, signal_id, auto_approve_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, agent.workspace_id, agent.id, targetId, channel, draft.subject, draft.body, signalId, autoAt);
  return id;
}

/**
 * Runner hook: the approved first-touch for this lead + channel, consumed once. Returns
 * null when there is none, so the step falls back to its own AI/template content.
 */
export function takeApprovedDraft(db: Database.Database, targetId: string, channel: Channel): { subject: string | null; body: string } | null {
  const row = db.prepare("SELECT id, subject, body FROM approval_queue WHERE target_id = ? AND channel = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1").get(targetId, channel) as { id: string; subject: string | null; body: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE approval_queue SET status = 'consumed', consumed_at = datetime('now') WHERE id = ?").run(row.id);
  return { subject: row.subject, body: row.body };
}
