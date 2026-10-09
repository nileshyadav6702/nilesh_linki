import { getDb } from "@/lib/db";

/**
 * Keeps the unified inbox fresh: each connected LinkedIn account and mailbox is synced right
 * after it connects, then every INTERVAL by the background schedule (or on "Sync now").
 * One sync per account at a time; failures are recorded per account, never thrown at callers.
 */

export type AccountKind = "linkedin" | "email";
const INTERVAL_MS = 15 * 60_000;
const running = new Set<string>();

function record(kind: AccountKind, id: string, error: string | null) {
  getDb().prepare(`INSERT INTO inbox_sync_state (account_kind, account_id, synced_at, error) VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(account_kind, account_id) DO UPDATE SET synced_at = excluded.synced_at, error = excluded.error`).run(kind, id, error);
}

export async function syncInboxAccount(kind: AccountKind, id: string): Promise<{ threads: number; messages: number } | null> {
  const key = `${kind}:${id}`;
  if (running.has(key)) return null;
  running.add(key);
  try {
    const r = kind === "linkedin"
      ? await (await import("@/lib/inbox/linkedin-sync")).syncLinkedInInbox(id)
      : await (await import("@/lib/inbox/email-sync")).syncEmailMailbox(id);
    record(kind, id, null);
    // Then swap internal-id profile links ("/in/ACoAAB…") for public URLs, a few per run.
    if (kind === "linkedin") {
      await (await import("@/lib/linkedin/public-url")).repairProfileUrls(id)
        .catch((err) => console.warn(`[inbox] profile URL repair for ${id}:`, err instanceof Error ? err.message : err));
    }
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A busy account is not a failure: it is retried on the next pass.
    if (!/busy/i.test(msg)) record(kind, id, msg.slice(0, 300));
    console.warn(`[inbox] ${kind} sync for ${id} failed: ${msg}`);
    return null;
  } finally { running.delete(key); }
}

/** Fire-and-forget sync of one account (right after it connects). */
export function queueInboxSync(kind: AccountKind, id: string): void {
  void syncInboxAccount(kind, id);
}

function accounts(workspaceId?: string): Array<{ kind: AccountKind; id: string; synced_at: string | null }> {
  const db = getDb();
  const ws = workspaceId ? " AND a.workspace_id = ?" : "";
  const args = workspaceId ? [workspaceId] : [];
  const li = db.prepare(`SELECT 'linkedin' kind, a.id, s.synced_at FROM accounts a LEFT JOIN inbox_sync_state s ON s.account_kind = 'linkedin' AND s.account_id = a.id WHERE a.is_authenticated = 1${ws}`).all(...args);
  const em = db.prepare(`SELECT 'email' kind, a.id, s.synced_at FROM email_accounts a LEFT JOIN inbox_sync_state s ON s.account_kind = 'email' AND s.account_id = a.id
    WHERE (a.imap_host IS NOT NULL OR a.oauth_connection_id IS NOT NULL)${ws}`).all(...args);
  return [...li, ...em] as Array<{ kind: AccountKind; id: string; synced_at: string | null }>;
}

/** "Sync now": every account of the workspace, in the background. */
export function syncWorkspaceInbox(workspaceId: string): number {
  const list = accounts(workspaceId);
  void (async () => { for (const a of list) await syncInboxAccount(a.kind, a.id); })();
  return list.length;
}

export function inboxSyncStatus(workspaceId: string) {
  const list = accounts(workspaceId);
  const db = getDb();
  return list.map((a) => {
    const s = db.prepare("SELECT synced_at, error FROM inbox_sync_state WHERE account_kind = ? AND account_id = ?").get(a.kind, a.id) as { synced_at: string; error: string | null } | undefined;
    return { kind: a.kind, id: a.id, synced_at: s?.synced_at ?? null, error: s?.error ?? null, running: running.has(`${a.kind}:${a.id}`) };
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Background schedule: every minute, sync accounts not synced in the last INTERVAL (one at a time). */
export function startInboxSyncSchedule(): void {
  if (timer || process.env.NODE_ENV === "test") return;
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const due = accounts().filter((a) => !a.synced_at || Date.parse(`${a.synced_at.replace(" ", "T")}Z`) < Date.now() - INTERVAL_MS);
        for (const a of due) await syncInboxAccount(a.kind, a.id);
      } catch (err) { console.warn("[inbox] schedule:", err instanceof Error ? err.message : err); }
      finally { busy = false; }
    })();
  }, 60_000);
  timer.unref?.();
}

export function stopInboxSyncSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
