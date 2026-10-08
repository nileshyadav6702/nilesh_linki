import type Database from "better-sqlite3";
import type { Channel } from "@/lib/agents/enroll";

/**
 * Approved agent drafts as the runner uses them: READ before the send, CONSUMED only once the
 * send succeeded. takeApprovedDraft (lib/agents/drafts.ts) consumes on read, so a send that
 * failed afterwards lost the approved copy and the retry fell back to generic step content.
 * Same selection rules as takeApprovedDraft.
 */

export interface PendingDraft { id: string; subject: string | null; body: string }

export function peekApprovedDraft(db: Database.Database, targetId: string, channel: Channel, stepId?: string, isFirst = true): PendingDraft | null {
  let row = stepId
    ? db.prepare("SELECT id, subject, body FROM approval_queue WHERE target_id = ? AND step_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1").get(targetId, stepId) as PendingDraft | undefined
    : undefined;
  if (!row && isFirst) {
    row = db.prepare("SELECT id, subject, body FROM approval_queue WHERE target_id = ? AND channel = ? AND step_id IS NULL AND status = 'approved' ORDER BY decided_at DESC LIMIT 1").get(targetId, channel) as PendingDraft | undefined;
  }
  return row ?? null;
}

/** Mark a draft used. Idempotent; a no-op for null. */
export function consumeDraft(db: Database.Database, draft: PendingDraft | null): void {
  if (!draft) return;
  db.prepare("UPDATE approval_queue SET status = 'consumed', consumed_at = datetime('now') WHERE id = ? AND status = 'approved'").run(draft.id);
}
