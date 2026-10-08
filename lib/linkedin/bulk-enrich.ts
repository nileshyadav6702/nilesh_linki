import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import { acquireEnrichLock, enrichProfileDetailed, type EnrichOutcome } from "@/lib/linkedin/enrich";
import { consume, discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";

/**
 * Bulk "enrich this list" requests, queued per LinkedIn account and worked off by that
 * account's worker in the LinkedIn loop (lib/linkedin/campaign/account-workers.ts).
 *
 * The API used to start a free-running background loop that drove the account's browser
 * session alongside outreach. Now it only queues the list; the account worker reads a bounded
 * slice of profiles per pass, after the account's outreach, imports and needs-data reads, under
 * the same per-account lock, charged to the same daily profile_view budget. A queued list
 * survives a restart (it lives in app_settings) and resumes where it stopped.
 */

/** Profiles one account worker pass may read for bulk enrichment. */
export const BULK_ENRICH_PER_SLICE = 10;

const KEY_PREFIX = "bulk_enrich:";
const keyFor = (accountId: string, listId: string) => `${KEY_PREFIX}${accountId}:${listId}`;

interface QueueEntry {
  list_id: string;
  account_id: string;
  queued_at: string;
  /** Last profile read, so a slice continues the pass instead of re-reading failures forever. */
  cursor: { created_at: string; id: string } | null;
  enriched: number;
  failed: number;
}

type DB = ReturnType<typeof getDb>;

function entries(db: DB, accountId?: string): QueueEntry[] {
  const rows = db.prepare("SELECT value FROM app_settings WHERE key LIKE ? ORDER BY updated_at ASC")
    .all(`${KEY_PREFIX}${accountId ? `${accountId}:` : ""}%`) as Array<{ value: string }>;
  const out: QueueEntry[] = [];
  for (const row of rows) {
    try { out.push(JSON.parse(row.value) as QueueEntry); } catch { /* malformed row: ignored */ }
  }
  return out.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

function save(db: DB, entry: QueueEntry): void {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(keyFor(entry.account_id, entry.list_id), JSON.stringify(entry));
}

function remove(db: DB, entry: QueueEntry): void {
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(keyFor(entry.account_id, entry.list_id));
}

/** True when the list is already queued (on any account). */
export function isBulkEnrichQueued(listId: string, db: DB = getDb()): boolean {
  return entries(db).some((e) => e.list_id === listId);
}

/** Queue a list for bulk enrichment on an account. False when the list is already queued. */
export function enqueueBulkEnrich(listId: string, accountId: string, db: DB = getDb()): boolean {
  return db.transaction(() => {
    if (isBulkEnrichQueued(listId, db)) return false;
    save(db, { list_id: listId, account_id: accountId, queued_at: new Date().toISOString(), cursor: null, enriched: 0, failed: 0 });
    return true;
  })();
}

/** Accounts with at least one queued list. */
export function bulkEnrichAccountIds(db: DB = getDb()): string[] {
  return Array.from(new Set(entries(db).map((e) => e.account_id)));
}

export interface BulkEnrichDeps {
  getContext: (accountId: string) => Promise<BrowserContext>;
  enrich: (ctx: BrowserContext, target: { id: string; sales_nav_url: string; full_name: string }) => Promise<EnrichOutcome>;
  delayMs: number;
  perSlice: number;
  shouldStop: () => boolean;
}

export interface BulkEnrichSliceResult {
  listId: string | null;
  attempted: number;
  done: boolean;
  stopped?: "paused" | "budget" | "blocked" | "busy" | "lease";
}

/**
 * One bounded slice of the account's oldest queued list. The list leaves the queue once every
 * unenriched profile in it has been read once; a budget stop, pause or block keeps it queued.
 */
export async function processBulkEnrichSlice(accountId: string, deps: Partial<BulkEnrichDeps> = {}): Promise<BulkEnrichSliceResult> {
  const db = getDb();
  const entry = entries(db, accountId)[0];
  if (!entry) return { listId: null, attempted: 0, done: false };
  const result: BulkEnrichSliceResult = { listId: entry.list_id, attempted: 0, done: false };
  if (discoveryPausedUntil(accountId)) return { ...result, stopped: "paused" };

  const perSlice = deps.perSlice ?? BULK_ENRICH_PER_SLICE;
  const targets = db.prepare(`
    SELECT t.id, t.sales_nav_url, COALESCE(t.full_name, t.id) AS full_name, t.created_at
      FROM targets t
      JOIN list_targets lt ON lt.target_id = t.id
     WHERE lt.list_id = ? AND t.sales_nav_url IS NOT NULL AND t.enriched_profile_at IS NULL
       AND (? IS NULL OR t.created_at > ? OR (t.created_at = ? AND t.id > ?))
     ORDER BY t.created_at ASC, t.id ASC
     LIMIT ?`).all(
    entry.list_id, entry.cursor?.created_at ?? null, entry.cursor?.created_at ?? null, entry.cursor?.created_at ?? null, entry.cursor?.id ?? null, perSlice,
  ) as Array<{ id: string; sales_nav_url: string; full_name: string; created_at: string }>;

  if (targets.length === 0) {
    remove(db, entry);
    console.log(`[enrich] list ${entry.list_id} done on ${accountId} — ${entry.enriched} enriched, ${entry.failed} failed`);
    return { ...result, done: true };
  }

  // The account worker already serialises this account; the lock also keeps out any other
  // enricher (a needs-data pass, an import) that is still finishing on the session.
  const release = acquireEnrichLock(`bulk:${entry.list_id}`, accountId);
  if (!release) return { ...result, stopped: "busy" };
  const getContext = deps.getContext ?? (async (id: string) => (await import("@/lib/linkedin/session")).getSessionContext(id));
  const enrich = deps.enrich ?? enrichProfileDetailed;
  const delayMs = deps.delayMs ?? 2000;
  try {
    const ctx = await getContext(accountId);
    for (let i = 0; i < targets.length; i++) {
      if (deps.shouldStop?.()) return { ...result, stopped: "lease" };
      if (!consume(accountId, "profile_view")) {
        console.warn(`[enrich] daily profile_view budget used up for ${accountId} — list ${entry.list_id} resumes tomorrow`);
        return { ...result, stopped: "budget" };
      }
      const target = targets[i];
      result.attempted++;
      const outcome = await enrich(ctx, target);
      if (outcome.status === "blocked") {
        pauseDiscovery(accountId, outcome.reason);
        console.warn(`[enrich] ${outcome.reason} on ${accountId} — bulk enrichment paused`);
        return { ...result, stopped: "blocked" };
      }
      if (outcome.status === "ok" || outcome.status === "empty") entry.enriched++; else entry.failed++;
      entry.cursor = { created_at: target.created_at, id: target.id };
      save(db, entry);
      if (delayMs > 0 && i < targets.length - 1) await new Promise((r) => setTimeout(r, delayMs + Math.random() * delayMs * 1.5));
    }
  } finally {
    release();
  }
  if (targets.length < perSlice) {
    remove(db, entry);
    console.log(`[enrich] list ${entry.list_id} done on ${accountId} — ${entry.enriched} enriched, ${entry.failed} failed`);
    return { ...result, done: true };
  }
  return result;
}
