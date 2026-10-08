import { randomUUID } from "crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import { aiJson } from "@/lib/ai/client";
import { getLatestIcp } from "@/lib/icp/store";

const replySchema = z.object({ body: z.string().min(5).max(2500) });

interface ReplyRow {
  id: string; workspace_id: string; target_id: string | null; from_email: string; subject: string | null; body_text: string;
  classification_json: string | null;
}

/** The meeting link to offer: the contact's agent's booking URL, else any agent's in the workspace. */
export function bookingUrlFor(db: Database.Database, workspaceId: string, targetId: string | null): string | null {
  const own = targetId ? db.prepare("SELECT a.booking_url FROM targets t JOIN agents a ON a.id = t.agent_id WHERE t.id = ?").get(targetId) as { booking_url: string | null } | undefined : undefined;
  if (own?.booking_url) return own.booking_url;
  const any = db.prepare("SELECT booking_url FROM agents WHERE workspace_id = ? AND booking_url IS NOT NULL ORDER BY updated_at DESC LIMIT 1").get(workspaceId) as { booking_url: string } | undefined;
  return any?.booking_url ?? null;
}

/** Drafts an answer to an inbound reply. Never sends: the user reviews it in the inbox. */
export async function draftReply(db: Database.Database, workspaceId: string, replyId: string): Promise<{ id: string; body: string; kind: string | null }> {
  const reply = db.prepare("SELECT id, workspace_id, target_id, from_email, subject, body_text, classification_json FROM email_replies WHERE id = ? AND workspace_id = ?").get(replyId, workspaceId) as ReplyRow | undefined;
  if (!reply) throw new Error("Reply not found");
  let kind: string | null = null;
  try { kind = (JSON.parse(reply.classification_json ?? "{}") as { kind?: string }).kind ?? null; } catch { /* unclassified */ }
  const contact = reply.target_id ? db.prepare("SELECT first_name, full_name, title, company FROM targets WHERE id = ?").get(reply.target_id) as Record<string, unknown> | undefined : undefined;
  const lastSent = reply.target_id ? db.prepare("SELECT subject, body_text AS body FROM email_jobs WHERE target_id = ? AND status = 'sent' ORDER BY created_at DESC LIMIT 1").get(reply.target_id) as { subject: string; body: string } | undefined : undefined;
  const icp = getLatestIcp(workspaceId)?.data;
  const booking = bookingUrlFor(db, workspaceId, reply.target_id);
  // The contact's agent can add its own guidance (Settings → LinkedIn seat → Inbox & AI replies).
  const guidance = reply.target_id ? (db.prepare("SELECT a.reply_instructions FROM targets t JOIN agents a ON a.id = t.agent_id WHERE t.id = ?").get(reply.target_id) as { reply_instructions: string | null } | undefined)?.reply_instructions?.trim() || null : null;

  const r = await aiJson({
    workspaceId,
    purpose: "reply_draft",
    temperature: 0.5,
    instructions: [
      "Draft a reply to the prospect's message in data.their_reply, continuing the thread in data.our_last_email.",
      "Positive or curious reply: thank them briefly, answer what they asked using only facts in data.offer, and propose a short call." + (booking ? " Offer the booking link in data.booking_url." : " Suggest two concrete time windows in the next three business days."),
      "Objection: acknowledge it in one sentence, address it with one fact from data.offer, and leave the door open. Not interested or unsubscribe: a one-line courteous close, nothing else.",
      "Out of office: a one-line note that you will follow up after they return.",
      "Plain text, 30-120 words, no signature block (the sender's mail client adds it). Never invent facts, prices or customers.",
      ...(guidance ? ["Also follow the user's own guidance in data.guidance, unless it conflicts with the rules above."] : []),
    ],
    data: {
      classification: kind,
      contact: contact ?? { email: reply.from_email },
      their_reply: { subject: reply.subject, body: reply.body_text.slice(0, 3000) },
      our_last_email: lastSent ? { subject: lastSent.subject, body: lastSent.body.slice(0, 1500) } : null,
      offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props } : null,
      booking_url: booking,
      guidance,
    },
    outputShape: `{"body":""}`,
    schema: replySchema,
  });
  const id = randomUUID();
  db.prepare("INSERT INTO reply_drafts (id, workspace_id, reply_id, body, kind) VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, replyId, r.body.trim(), kind);
  return { id, body: r.body.trim(), kind };
}
