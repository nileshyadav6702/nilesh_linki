import { randomUUID } from "crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import { aiJson } from "@/lib/ai/client";
import type { Icp } from "@/lib/icp/schema";
import type { Agent } from "@/lib/agents/store";
import { workflowChannels, type Channel } from "@/lib/agents/enroll";

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

// ─── the campaign as a timeline ───────────────────────────────────────────────

export interface SequenceStep {
  id: string; track: "linkedin" | "email"; step_type: string; order: number;
  /** Days after enrollment this step is expected to run (sum of delays before it on its track). */
  day: number;
  /** 1-based position among this track's message/email steps; null for non-writing steps. */
  position: number | null;
  channel: Channel | null;
  /** The same text goes to everyone (set in the Campaign tab), so the agent writes no draft for it. */
  fixed?: boolean;
  label: string;
}

const STEP_LABEL: Record<string, string> = { visit: "Visit profile", connect: "Connection request", message: "LinkedIn message", email: "Email", sales_inmail: "InMail", delay: "Wait", like_posts: "Like posts", voice: "Voice message" };

export function sequenceSteps(db: Database.Database, workflowId: string | null): SequenceStep[] {
  if (!workflowId) return [];
  const rows = db.prepare(`SELECT id, track, step_type, step_order, delay_seconds, send_mode FROM workflow_steps
    WHERE workflow_id = ? AND COALESCE(enabled, 1) = 1 ORDER BY track DESC, step_order`).all(workflowId) as Array<{ id: string; track: string; step_type: string; step_order: number; delay_seconds: number | null; send_mode: string | null }>;
  const out: SequenceStep[] = [];
  const day: Record<string, number> = { linkedin: 0, email: 0 };
  const pos: Record<string, number> = { linkedin: 0, email: 0 };
  for (const r of rows) {
    const track = r.track === "email" ? "email" : "linkedin";
    if (r.step_type === "delay") { day[track] += Math.round((r.delay_seconds ?? 0) / 86_400); continue; }
    const writes = r.step_type === "message" || r.step_type === "email";
    if (writes) pos[track]++;
    out.push({
      id: r.id, track, step_type: r.step_type, order: r.step_order, day: day[track],
      position: writes ? pos[track] : null,
      channel: r.step_type === "message" ? "linkedin_message" : r.step_type === "email" ? "email" : null,
      label: STEP_LABEL[r.step_type] ?? r.step_type,
      fixed: r.send_mode === "fixed",
    });
  }
  // Interleave the two parallel tracks by expected day, LinkedIn first on ties.
  return out.sort((a, b) => a.day - b.day || (a.track === b.track ? a.order - b.order : a.track === "linkedin" ? -1 : 1));
}

/** The steps the AI writes for this lead: message/email steps on channels the lead is reachable on. */
export function draftableSteps(db: Database.Database, agent: Agent, target: { linkedin_url: string | null; email: string | null }): SequenceStep[] {
  return sequenceSteps(db, agent.workflow_id).filter((s) => !s.fixed && (
    (s.channel === "linkedin_message" && !!target.linkedin_url && !!agent.linkedin_account_id) ||
    (s.channel === "email" && !!target.email && !!agent.email_account_id)));
}

// ─── writing ──────────────────────────────────────────────────────────────────

const sequenceSchema = z.object({
  steps: z.array(z.object({
    key: z.string(),
    subject: z.string().max(140).nullable().optional(),
    body: z.string().min(5).max(2000),
  })).min(1).max(12),
});

const TONE: Record<string, string> = {
  professional: "Professional and polished, but warm.",
  conversational: "Friendly and casual, like a peer.",
  direct: "Bold and confident; get to the point in the first line.",
};

function roleOf(step: SequenceStep, totalOnTrack: number): string {
  if (step.position === 1) return "first touch: open on the lead's strongest signal, connect it to one pain point, end with one low-friction question";
  if (step.position === totalOnTrack && totalOnTrack > 2) return "closing note: brief, polite last attempt that makes it easy to say no";
  return "follow-up: add one new angle or value point; do not repeat earlier messages";
}

export interface LeadContext { contact: Record<string, unknown>; company: Record<string, unknown> | null; signals: StrongSignal[] }

function contextData(agent: Agent, icp: Icp | null, lead: LeadContext) {
  const c = lead.contact;
  return {
    contact: { first_name: c.first_name, full_name: c.full_name, headline: c.headline, title: c.title, company: c.company, location: c.location, about: typeof c.summary === "string" ? c.summary.slice(0, 500) : null },
    company: lead.company ? { name: lead.company.name, industry: lead.company.industry, description: typeof lead.company.description === "string" ? lead.company.description.slice(0, 300) : null } : null,
    signals: lead.signals.map((s) => ({ what: s.title, detail: s.snippet, when: s.occurred_at })),
    offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props, pain_points: icp.pain_points } : null,
    campaign_goal: agent.goal === "meetings" ? "book a short sales call or demo" : "start a genuine conversation with a warm prospect",
    booking_url: agent.goal === "meetings" ? agent.booking_url : null,
  };
}

/** Messages are written in the ICP's language (callers swap in the user's own when they generate). */
const writeIn = (icp: Icp | null) => `Write every message in ${icp?.language?.trim() || "English"}.`;

const RULES = [
  "Use only facts present in data; never invent numbers, customers, events or relationships. No flattery, hype, emojis or links (except data.booking_url in a closing or meetings-goal message).",
  "Never say you were tracking or monitoring the person. Address them by first name. Plain text.",
  "LinkedIn messages: 30-70 words. Emails: 50-110 words with a specific subject of at most 7 words; follow-up emails reply in the same thread, so their subject starts with \"Re: \" and repeats the first email's subject.",
];

/** Writes every AI step of the sequence for one lead in a single call, so the steps read as one arc. */
export async function writeSequence(agent: Agent, icp: Icp | null, steps: SequenceStep[], lead: LeadContext): Promise<Map<string, { subject: string | null; body: string }>> {
  const perTrack = (t: string) => steps.filter((s) => s.track === t).length;
  const r = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "first_touch",
    temperature: 0.6,
    instructions: [
      "Write the outreach sequence for this lead: one message for each entry in data.steps, in order, as one coherent arc.",
      `Tone: ${TONE[agent.tone] ?? TONE.professional}`,
      writeIn(icp),
      ...RULES,
    ],
    data: { ...contextData(agent, icp, lead), steps: steps.map((s) => ({ key: s.id, channel: s.channel, send_day: s.day, role: roleOf(s, perTrack(s.track)) })) },
    outputShape: `{"steps":[{"key":"<step key>","subject":"only for email channel, else null","body":""}]}`,
    schema: sequenceSchema,
  });
  const out = new Map<string, { subject: string | null; body: string }>();
  for (const s of r.steps) {
    const step = steps.find((x) => x.id === s.key);
    if (!step) {
      console.warn(`[agents] model returned a draft for unknown step key "${String(s.key).slice(0, 60)}" (agent ${agent.id}); dropped`);
      continue;
    }
    out.set(step.id, { subject: step.channel === "email" ? (s.subject?.trim() || "Quick question") : null, body: s.body.trim() });
  }
  return out;
}

/** Rewrites one step, optionally following the user's instruction ("make it shorter"). */
export async function rewriteStep(agent: Agent, icp: Icp | null, step: SequenceStep, totalOnTrack: number, lead: LeadContext,
  current: { subject: string | null; body: string }, instruction: string | null, otherSteps: Array<{ label: string; body: string }>): Promise<{ subject: string | null; body: string }> {
  const r = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "first_touch",
    temperature: instruction ? 0.4 : 0.8,
    instructions: [
      instruction
        ? "Revise data.current_draft following data.user_instruction. Keep everything the instruction does not ask to change."
        : "Write a fresh alternative to data.current_draft for the same step; same goal, different wording and angle.",
      `This step's role: ${roleOf(step, totalOnTrack)}. Do not repeat the other messages in data.other_steps.`,
      `Tone: ${TONE[agent.tone] ?? TONE.professional}`,
      writeIn(icp),
      ...RULES,
    ],
    data: { ...contextData(agent, icp, lead), channel: step.channel, current_draft: current, user_instruction: instruction, other_steps: otherSteps },
    outputShape: step.channel === "email" ? `{"subject":"","body":""}` : `{"body":""}`,
    schema: z.object({ subject: z.string().max(140).nullable().optional(), body: z.string().min(5).max(2000) }),
  });
  return { subject: step.channel === "email" ? (r.subject?.trim() || current.subject) : null, body: r.body.trim() };
}

// ─── queue ────────────────────────────────────────────────────────────────────

export function queueDraft(db: Database.Database, agent: Agent, targetId: string, channel: Channel, draft: { subject: string | null; body: string }, signalId: string | null, step?: Pick<SequenceStep, "id" | "position">): string {
  const id = randomUUID();
  const autoAt = agent.mode === "autopilot" ? new Date(Date.now() + agent.autopilot_delay_minutes * 60_000).toISOString() : null;
  db.prepare(`INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, subject, body, signal_id, auto_approve_at, step_id, position, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(id, agent.workspace_id, agent.id, targetId, channel, draft.subject, draft.body, signalId, autoAt, step?.id ?? null, step?.position ?? 1);
  return id;
}

/**
 * Runner hook: the approved text for this lead at this step, consumed once. Falls back to
 * a step-less first-touch draft (older agents) for the first message of a track. Returns
 * null when there is none, so the step uses its own AI/template content.
 */
export function takeApprovedDraft(db: Database.Database, targetId: string, channel: Channel, stepId?: string, isFirst = true): { subject: string | null; body: string } | null {
  let row = stepId
    ? db.prepare("SELECT id, subject, body FROM approval_queue WHERE target_id = ? AND step_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1").get(targetId, stepId) as { id: string; subject: string | null; body: string } | undefined
    : undefined;
  if (!row && isFirst) row = db.prepare("SELECT id, subject, body FROM approval_queue WHERE target_id = ? AND channel = ? AND step_id IS NULL AND status = 'approved' ORDER BY decided_at DESC LIMIT 1").get(targetId, channel) as typeof row;
  if (!row) return null;
  db.prepare("UPDATE approval_queue SET status = 'consumed', consumed_at = datetime('now') WHERE id = ?").run(row.id);
  return { subject: row.subject, body: row.body };
}
