import type Database from "better-sqlite3";
import { emitDomainEvent } from "@/lib/platform/events";
import { enrollLead } from "@/lib/agents/enroll";
import type { Agent } from "@/lib/agents/store";

export interface ApprovalRow {
  id: string; workspace_id: string; agent_id: string | null; target_id: string; channel: string;
  subject: string | null; body: string; status: string; auto_approve_at: string | null; signal_id: string | null; created_at: string;
}

/** Once no draft for the lead is still pending, enroll it (any approved) or skip it (all rejected). */
function settleLead(db: Database.Database, agent: Agent | null, targetId: string): { enrolled: boolean; reason?: string } {
  const pending = (db.prepare("SELECT COUNT(*) n FROM approval_queue WHERE target_id = ? AND status = 'pending'").get(targetId) as { n: number }).n;
  if (pending > 0) return { enrolled: false, reason: "Other drafts still pending" };
  const approved = (db.prepare("SELECT COUNT(*) n FROM approval_queue WHERE target_id = ? AND status IN ('approved','consumed')").get(targetId) as { n: number }).n;
  if (!approved) {
    db.prepare("UPDATE targets SET agent_status = 'skipped', skip_reason = COALESCE(skip_reason, 'Drafts rejected'), agent_status_at = datetime('now') WHERE id = ?").run(targetId);
    return { enrolled: false, reason: "All drafts rejected" };
  }
  if (!agent) return { enrolled: false, reason: "Agent missing" };
  return enrollLead(db, agent, targetId);
}

export function decideDraft(db: Database.Database, workspaceId: string, id: string, decision: "approve" | "reject", userId: string | null, edits?: { subject?: string | null; body?: string }) {
  const row = db.prepare("SELECT * FROM approval_queue WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as ApprovalRow | undefined;
  if (!row) return { ok: false as const, error: "Draft not found" };
  if (row.status !== "pending") return { ok: false as const, error: `Draft already ${row.status}` };
  if (edits?.body !== undefined && edits.body.trim().length < 2) return { ok: false as const, error: "Message body is empty" };
  db.prepare(`UPDATE approval_queue SET status = ?, subject = COALESCE(?, subject), body = COALESCE(?, body), decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
    .run(decision === "approve" ? "approved" : "rejected", edits?.subject ?? null, edits?.body?.trim() ?? null, userId, id);
  const agent = row.agent_id ? (db.prepare("SELECT * FROM agents WHERE id = ?").get(row.agent_id) as Agent | undefined) ?? null : null;
  const settled = settleLead(db, agent, row.target_id);
  if (decision === "approve") emitDomainEvent({ workspaceId, type: "draft.approved", entityType: "contact", entityId: row.target_id, payload: { draft_id: id, channel: row.channel } });
  return { ok: true as const, ...settled };
}

/** Save an edit to a pending draft without deciding it. */
export function saveDraft(db: Database.Database, workspaceId: string, id: string, edits: { subject?: string | null; body?: string }) {
  const row = db.prepare("SELECT status FROM approval_queue WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as { status: string } | undefined;
  if (!row) return { ok: false as const, error: "Draft not found" };
  if (row.status !== "pending") return { ok: false as const, error: `Draft already ${row.status}` };
  if (edits.body !== undefined && edits.body.trim().length < 2) return { ok: false as const, error: "Message body is empty" };
  db.prepare("UPDATE approval_queue SET subject = COALESCE(?, subject), body = COALESCE(?, body), updated_at = datetime('now') WHERE id = ?")
    .run(edits.subject ?? null, edits.body?.trim() ?? null, id);
  return { ok: true as const };
}

/**
 * Copilot decides per contact: approving approves every pending step draft (enrolling the
 * lead); rejecting rejects them all and skips the lead.
 */
export function decideLead(db: Database.Database, workspaceId: string, targetId: string, decision: "approve" | "reject", userId: string | null, reason?: string) {
  const pending = db.prepare("SELECT id FROM approval_queue WHERE target_id = ? AND workspace_id = ? AND status = 'pending' ORDER BY position").all(targetId, workspaceId) as Array<{ id: string }>;
  if (!pending.length) return { ok: false as const, error: "Nothing to review for this contact" };
  let last: ReturnType<typeof decideDraft> = { ok: false, error: "Nothing decided" };
  for (const d of pending) last = decideDraft(db, workspaceId, d.id, decision, userId);
  if (decision === "reject" && reason) db.prepare("UPDATE targets SET skip_reason = ? WHERE id = ?").run(reason.slice(0, 300), targetId);
  return last;
}

/** Autopilot: approve drafts whose review window has passed. */
export function autoApproveDue(db: Database.Database, agent: Agent): number {
  const due = db.prepare("SELECT id FROM approval_queue WHERE agent_id = ? AND status = 'pending' AND auto_approve_at IS NOT NULL AND auto_approve_at <= ?")
    .all(agent.id, new Date().toISOString()) as Array<{ id: string }>;
  for (const d of due) decideDraft(db, agent.workspace_id, d.id, "approve", null);
  return due.length;
}
