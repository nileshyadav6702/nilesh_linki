import type Database from "better-sqlite3";
import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { getLatestIcp } from "@/lib/icp/store";

/**
 * AI reply drafts for LinkedIn conversations (Settings → LinkedIn seat → Inbox & AI replies →
 * "AI draft reply"). When a synced conversation's latest message is from the other person, the
 * seat drafts an answer and stores it on the thread; the inbox pre-fills the reply box with it.
 * Nothing is sent: the user edits and presses Send.
 */

type DB = Database.Database;
const draftSchema = z.object({ body: z.string().min(2).max(1500) });

/** Drafts per sync pass, so a backlog of old conversations can't run up the AI bill at once. */
export const DRAFTS_PER_PASS = 10;

interface ThreadRow {
  id: string; workspace_id: string; account_id: string; target_id: string | null; participant_name: string | null; participant_headline: string | null;
  ai_draft_for: string | null;
}
interface SeatRow { ai_draft_replies: number; inbox_contacts_only: number; booking_url: string | null; reply_instructions: string | null; name: string | null }

/** Draft a reply to the thread's latest inbound message. Returns the draft, or null when there's nothing to answer. */
export async function draftLinkedInReply(db: DB, threadId: string): Promise<string | null> {
  const t = db.prepare("SELECT id, workspace_id, account_id, target_id, participant_name, participant_headline, ai_draft_for FROM inbox_threads WHERE id = ? AND channel = 'linkedin'").get(threadId) as ThreadRow | undefined;
  if (!t) return null;
  const msgs = db.prepare("SELECT id, direction, body_text, sent_at FROM inbox_messages WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 12").all(threadId) as Array<{ id: string; direction: "in" | "out"; body_text: string | null; sent_at: string }>;
  const last = msgs[0];
  if (!last || last.direction !== "in" || !last.body_text?.trim() || last.id === t.ai_draft_for) return null;
  const seat = db.prepare("SELECT ai_draft_replies, inbox_contacts_only, booking_url, reply_instructions, name FROM accounts WHERE id = ?").get(t.account_id) as SeatRow | undefined;
  const contact = t.target_id ? db.prepare("SELECT first_name, full_name, title, company FROM targets WHERE id = ?").get(t.target_id) as Record<string, unknown> | undefined : undefined;
  const agent = t.target_id ? db.prepare("SELECT a.booking_url, a.reply_instructions FROM targets x JOIN agents a ON a.id = x.agent_id WHERE x.id = ?").get(t.target_id) as { booking_url: string | null; reply_instructions: string | null } | undefined : undefined;
  const booking = seat?.booking_url?.trim() || agent?.booking_url || null;
  const guidance = seat?.reply_instructions?.trim() || agent?.reply_instructions?.trim() || null;
  const icp = getLatestIcp(t.workspace_id)?.data;

  const r = await aiJson({
    workspaceId: t.workspace_id,
    purpose: "reply_draft",
    temperature: 0.5,
    instructions: [
      "Draft the next LinkedIn message from us in the conversation in data.conversation (oldest first; 'us' wrote the 'out' messages, 'them' the 'in' ones). Answer their latest message.",
      "Interested or curious: answer what they asked using only facts in data.offer and suggest a short call." + (booking ? " Offer the booking link in data.booking_url." : ""),
      "Objection: acknowledge it in one sentence and address it with one fact from data.offer. Not interested: a one-line courteous close. A plain greeting or thanks: a short friendly reply that keeps the conversation going.",
      "LinkedIn chat style: plain text, 15-80 words, no subject line, no signature. Match their language. Never invent facts, prices or customers.",
      ...(guidance ? ["Also follow the user's guidance in data.guidance, unless it conflicts with the rules above."] : []),
    ],
    data: {
      contact: contact ?? { name: t.participant_name, headline: t.participant_headline },
      conversation: [...msgs].reverse().map((m) => ({ from: m.direction === "in" ? "them" : "us", text: (m.body_text ?? "").slice(0, 1200) })),
      offer: icp ? { company: icp.company_name, offer: icp.offer, value_props: icp.value_props } : null,
      booking_url: booking,
      guidance,
    },
    outputShape: `{"body":""}`,
    schema: draftSchema,
  });
  const body = r.body.trim();
  db.prepare("UPDATE inbox_threads SET ai_draft = ?, ai_draft_for = ? WHERE id = ?").run(body, last.id, threadId);
  return body;
}

/** After a sync: draft replies for the seat's conversations that got new activity, when the seat has drafting on. */
export async function draftPendingReplies(db: DB, accountId: string, threadIds: string[]): Promise<number> {
  const seat = db.prepare("SELECT ai_draft_replies, inbox_contacts_only FROM accounts WHERE id = ?").get(accountId) as Pick<SeatRow, "ai_draft_replies" | "inbox_contacts_only"> | undefined;
  if (!seat?.ai_draft_replies || !threadIds.length) return 0;
  // With "only my contacts" on, conversations with strangers are hidden: don't spend on them either.
  const ids = (db.prepare(`SELECT id FROM inbox_threads WHERE id IN (${threadIds.map(() => "?").join(",")}) AND deleted = 0 ${seat.inbox_contacts_only ? "AND target_id IS NOT NULL" : ""}
    ORDER BY last_message_at DESC`).all(...threadIds) as Array<{ id: string }>).map((r) => r.id).slice(0, DRAFTS_PER_PASS);
  let n = 0;
  for (const id of ids) {
    try { if (await draftLinkedInReply(db, id)) n++; } catch (err) {
      console.warn(`[inbox] AI draft for ${id} failed:`, err instanceof Error ? err.message : err);
      break; // no AI key, spend cap or provider down: the next sync tries again
    }
  }
  return n;
}
