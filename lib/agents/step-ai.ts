import type Database from "better-sqlite3";
import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { communityAi } from "@/lib/community-ai";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { renderOutreachTemplate } from "@/lib/outreach/render";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { sequenceSteps, strongestSignals, writeSequence, type SequenceStep } from "@/lib/agents/drafts";
import type { Agent } from "@/lib/agents/store";

/**
 * AI helpers behind a campaign step's edit drawer: preview the AI message for a sample lead
 * (with the step's template and the campaign language, nothing saved), write a "same message
 * for everyone" draft with variables, and build the test email.
 */

type DB = Database.Database;

export function agentForWorkflow(db: DB, workspaceId: string, workflowId: string): Agent | null {
  return (db.prepare("SELECT * FROM agents WHERE workflow_id = ? AND workspace_id = ? ORDER BY created_at LIMIT 1").get(workflowId, workspaceId) as Agent | undefined) ?? null;
}

function icpFor(agent: Agent) {
  return (agent.icp_id ? getIcp(agent.icp_id, agent.workspace_id) : getLatestIcp(agent.workspace_id))?.data ?? null;
}

/** The AI message this step would write for `targetId`. `templateId` previews an unsaved template choice. */
export async function previewAiStep(db: DB, agent: Agent, stepId: string, targetId: string, templateId?: string | null): Promise<{ subject: string | null; body: string }> {
  const base = sequenceSteps(db, agent.workflow_id).find((s) => s.id === stepId);
  if (!base?.channel) throw new Error("Save this step first, then preview it");
  const step: SequenceStep = templateId === undefined ? base : { ...base, ai_template_id: templateId };
  const bundle = communityAi.getContactWithCompany(targetId);
  if (!bundle) throw new Error("Contact not found");
  const written = (await writeSequence(agent, icpFor(agent), [step], { contact: bundle.contact, company: bundle.company, signals: strongestSignals(db, targetId) })).get(step.id);
  if (!written) throw new Error("The AI didn't return a message. Try again.");
  return written;
}

const fixedSchema = z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().min(5).max(1900) });

/** A reusable message with {{variables}}, for "Same message for everyone". */
export async function generateFixedMessage(agent: Agent, kind: "message" | "email" | "note"): Promise<{ subject: string | null; body: string }> {
  const icp = icpFor(agent);
  const r = await aiJson({
    workspaceId: agent.workspace_id,
    purpose: "sequence_write",
    temperature: 0.6,
    instructions: [
      `Write one ${kind === "email" ? "cold email" : kind === "note" ? "LinkedIn connection note (at most 180 characters)" : "LinkedIn message"} that will be sent unchanged to every lead, so it must not contain facts about any one person.`,
      "Personalise only with these variables, written exactly like this: {{first_name}}, {{company}}, {{title}}. Use {{first_name}} in the greeting. Use at most three variables.",
      `Goal: ${agent.goal === "meetings" ? "book a short call" : "start a genuine conversation"}. Tone: ${agent.tone}. Use only facts in data.offer; no hype, emojis or links.`,
      kind === "email" ? "Also write a subject of at most 7 words (it may use {{company}}). Body 50-110 words." : kind === "note" ? "No subject." : "30-70 words. Separate the greeting, the point and the question with blank lines. No subject.",
      `Write in ${agent.language?.trim() || icp?.language?.trim() || "English"}.`,
    ],
    data: { offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props, personas: icp.personas?.map((p) => p.titles).flat().slice(0, 6) } : null },
    outputShape: `{"subject":"","body":""}`,
    schema: fixedSchema,
  });
  return { subject: kind === "email" ? (r.subject ?? "").trim() || null : null, body: r.body.trim() };
}

/** A fixed message rendered for one lead (the preview and the test email of "Same message for everyone"). */
export function renderForLead(db: DB, workspaceId: string, targetId: string, text: string): string {
  const t = db.prepare("SELECT first_name, last_name, full_name, company, title, location FROM targets WHERE id = ? AND workspace_id = ?").get(targetId, workspaceId) as Record<string, string | null> | undefined;
  if (!t) throw new Error("Contact not found");
  return renderOutreachTemplate(text, t, loadTargetCustomValues(db, workspaceId, targetId));
}
