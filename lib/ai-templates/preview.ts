import type Database from "better-sqlite3";
import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { strongestSignals } from "@/lib/agents/drafts";
import { getLatestIcp } from "@/lib/icp/store";
import { displayName, getUserProfile } from "@/lib/user-profile";
import { tokensForPrompt, type Channel, type Kind } from "@/lib/ai-templates/store";

/** Send-like preview: the template filled in for one contact, the way the agent would write it. */

const ROLE: Record<Kind, string> = {
  icebreaker: "first message of the sequence",
  followup: "follow-up message that builds on an earlier one",
  closing: "last message of the sequence; keep the door open",
};

export async function previewTemplate(db: Database.Database, workspaceId: string, userId: string | null, input: {
  channel: Channel; kind: Kind; subject: string | null; body: string; ai_instructions: string | null; target_id: string;
}): Promise<{ subject: string | null; body: string }> {
  const c = db.prepare(`SELECT first_name, last_name, full_name, title, headline, company, location, summary, company_description, company_industry
    FROM targets WHERE id = ? AND workspace_id = ?`).get(input.target_id, workspaceId) as Record<string, string | null> | undefined;
  if (!c) throw new Error("Contact not found");
  const icp = getLatestIcp(workspaceId)?.data ?? null;
  const me = userId ? getUserProfile(db, userId) : null;
  const sender = displayName(me) ?? me?.email?.split("@")[0] ?? null;
  const signals = strongestSignals(db, input.target_id).map((s) => ({ what: s.title, detail: s.snippet, when: s.occurred_at }));
  const language = (me?.language ?? icp?.language ?? "English").trim() || "English";
  const email = input.channel === "email";
  const r = await aiJson({
    workspaceId,
    purpose: "first_touch",
    temperature: 0.5,
    instructions: [
      `Write the ${email ? "email" : "LinkedIn message"} for this lead by filling in data.template: it is the ${ROLE[input.kind]}.`,
      "Follow the template's structure, order and fixed wording closely: replace each [Variable] with the matching value from data (sender = data.sender), expand each [AI block: …] into one specific sentence from data, turn [CTA] into one low-friction call to action, and follow data.template.instructions. Never print the brackets.",
      `Write in ${language}.`,
      "Use only facts present in data; never invent numbers, customers, events or relationships. No flattery, hype or emojis. Plain text, paragraphs separated by a blank line.",
      email ? "Fill the subject the same way, at most 8 words." : "LinkedIn messages stay under 700 characters.",
    ],
    data: {
      template: { subject: email ? tokensForPrompt(input.subject) : null, body: tokensForPrompt(input.body), instructions: tokensForPrompt(input.ai_instructions) },
      contact: { first_name: c.first_name, last_name: c.last_name, full_name: c.full_name, job_title: c.title ?? c.headline, company: c.company, location: c.location, about: c.summary?.slice(0, 500) ?? null },
      company: { name: c.company, industry: c.company_industry, description: c.company_description?.slice(0, 300) ?? null },
      intent: signals,
      sender: { full_name: sender, first_name: sender?.split(" ")[0] ?? null, company: icp?.company_name ?? null },
      offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props, pain_points: icp.pain_points } : null,
    },
    outputShape: email ? `{"subject":"","body":""}` : `{"body":""}`,
    schema: z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().min(5).max(4000) }),
  });
  return { subject: email ? r.subject?.trim() || null : null, body: r.body.trim() };
}
