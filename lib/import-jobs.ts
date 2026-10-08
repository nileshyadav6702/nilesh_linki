import type DatabaseType from "better-sqlite3";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

type DB = DatabaseType.Database;

const PAGE_SIZE = 25;
export const DEFAULT_DAILY_CAP = 1500;

export interface ImportRow {
  id: string;
  list_id: string;
  account_id: string | null;
  sales_nav_url: string | null;
  status: string;
  phase: string | null;
  page: number;
  total_pages: number;
  count: number;
  total: number;
  imported: number;
  skipped: number;
  error: string | null;
  scheduled_for: string | null;
  start_page: number;
  cap: number | null;
  cancel_requested: number;
  batch_index: number;
  enrich: number;
  started_at: string;
  finished_at: string | null;
}

// ─── settings ────────────────────────────────────────────────────────────────

const GLOBAL_CAP_KEY = "daily_import_cap";
const workspaceCapKey = (workspaceId: string) => `daily_import_cap:${workspaceId}`;

/**
 * The daily import cap. Per workspace: one tenant's setting must not change another's quota.
 * Without a workspace (legacy callers) or when the workspace never set one, falls back to the
 * old instance-wide value, then to DEFAULT_DAILY_CAP.
 */
export function getDailyImportCap(db: DB = getDb(), workspaceId?: string | null): number {
  const keys = workspaceId ? [workspaceCapKey(workspaceId), GLOBAL_CAP_KEY] : [GLOBAL_CAP_KEY];
  for (const key of keys) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    const n = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_DAILY_CAP;
}

/** Set the cap for one workspace (or, without one, the legacy instance-wide fallback). */
export function setDailyImportCap(db: DB, n: number, workspaceId?: string | null): void {
  const v = String(Math.max(1, Math.floor(n)));
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(workspaceId ? workspaceCapKey(workspaceId) : GLOBAL_CAP_KEY, v);
}

// ─── quota ───────────────────────────────────────────────────────────────────

/**
 * Contacts imported today (UTC day). With a workspace, only that workspace's lists count -
 * the cap is per workspace, so the quota must be too. Without one: every list (legacy).
 */
export function importedToday(db: DB, workspaceId?: string | null): number {
  const base = `SELECT COALESCE(SUM(li.imported), 0) c FROM list_imports li
       WHERE li.status IN ('done', 'running') AND date(COALESCE(li.finished_at, li.started_at)) = date('now')`;
  const row = (workspaceId
    ? db.prepare(`${base} AND li.list_id IN (SELECT id FROM lists WHERE workspace_id = ?)`).get(workspaceId)
    : db.prepare(base).get()) as { c: number };
  return row.c;
}

// ─── liveness ────────────────────────────────────────────────────────────────

/** A 'running' import whose heartbeat is older than this is dead, not active. */
export const IMPORT_STALE_MINUTES = 15;

/**
 * Is an import queued or genuinely in progress for this list? A 'running' row whose worker
 * died (crash, restart, wedged loop) is NOT active - counting it blocked every later import
 * for that list forever.
 */
export function hasActiveImport(db: DB, listId: string): boolean {
  return !!db.prepare(
    `SELECT 1 FROM list_imports WHERE list_id = ? AND cancel_requested = 0 AND (
       status = 'scheduled'
       OR (status = 'running' AND heartbeat_at IS NOT NULL AND heartbeat_at >= datetime('now', ?))
     ) LIMIT 1`
  ).get(listId, `-${IMPORT_STALE_MINUTES} minutes`);
}

/**
 * Put dead 'running' imports back in the queue (or close them, if a cancel was requested).
 * A row with no heartbeat predates heartbeats or never got going; a row whose heartbeat is
 * stale lost its worker. Its contacts were not inserted (insert happens at the end of a
 * batch), so resuming from the same start_page loses nothing. Returns rows recovered.
 */
export function recoverStaleImports(db: DB): number {
  return db.prepare(
    `UPDATE list_imports SET
       status = CASE WHEN cancel_requested = 1 THEN 'canceled' ELSE 'scheduled' END,
       scheduled_for = CASE WHEN cancel_requested = 1 THEN scheduled_for ELSE date('now') END,
       finished_at = CASE WHEN cancel_requested = 1 THEN datetime('now') ELSE finished_at END,
       error = CASE WHEN cancel_requested = 1 THEN error ELSE 'Interrupted (worker stopped); resumed automatically' END,
       phase = NULL
     WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < datetime('now', ?))`
  ).run(`-${IMPORT_STALE_MINUTES} minutes`).changes;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysStr(base: string, days: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Queue an import for a list. Creates the first batch as 'scheduled' for today;
 * the runner's scheduler picks it up (one import at a time). Large lists are
 * split across days under the daily cap by runBatch chaining continuations.
 */
export function startImport(
  db: DB,
  opts: { listId: string; accountId: string; salesNavUrl: string; enrich?: boolean }
): { importId: string } {
  cancelImportsForList(db, opts.listId); // supersede any prior import for this list
  const importId = randomUUID();
  db.prepare(
    `INSERT INTO list_imports
       (id, list_id, account_id, sales_nav_url, status, scheduled_for, start_page, batch_index, enrich, started_at)
     VALUES (?, ?, ?, ?, 'scheduled', ?, 1, 1, ?, datetime('now'))`
  ).run(importId, opts.listId, opts.accountId, opts.salesNavUrl, todayStr(), opts.enrich ? 1 : 0);
  return { importId };
}

export function cancelImportsForList(db: DB, listId: string): void {
  db.prepare(
    `UPDATE list_imports
       SET cancel_requested = 1,
           status = CASE WHEN status = 'scheduled' THEN 'canceled' ELSE status END,
           finished_at = CASE WHEN status = 'scheduled' THEN datetime('now') ELSE finished_at END
     WHERE list_id = ? AND status IN ('scheduled', 'running')`
  ).run(listId);
}

export function cancelImport(db: DB, importId: string): void {
  db.prepare(
    `UPDATE list_imports
       SET cancel_requested = 1,
           status = CASE WHEN status = 'scheduled' THEN 'canceled' ELSE status END,
           finished_at = CASE WHEN status = 'scheduled' THEN datetime('now') ELSE finished_at END
     WHERE id = ?`
  ).run(importId);
}

// ─── scheduler + executor ────────────────────────────────────────────────────

/** Pages one pass may scrape. Each page waits 60-120s, so this bounds a pass to minutes. */
export const IMPORT_PAGES_PER_PASS = 4;
/** Cooperative deadline for a pass: no new page is started after it. */
export const IMPORT_PASS_BUDGET_MS = 6 * 60_000;

let importRunning = false;

/**
 * Runner hook, called from the LinkedIn loop - in sequence with outreach, never alongside
 * it, because both drive the same browser session. Runs at most one bounded pass of the next
 * due batch and AWAITS it; the remainder is chained as a new batch (today while quota lasts,
 * else tomorrow). `importRunning` is reset in finally, so a crashed pass cannot wedge imports.
 */
export async function processScheduledImports(db: DB, opts: { budgetMs?: number } = {}): Promise<void> {
  if (importRunning) return;
  importRunning = true;
  try {
    recoverStaleImports(db);
    const due = db
      .prepare(
        `SELECT * FROM list_imports
         WHERE status = 'scheduled' AND cancel_requested = 0
           AND (scheduled_for IS NULL OR scheduled_for <= date('now'))
         ORDER BY scheduled_for ASC, batch_index ASC LIMIT 1`
      )
      .get() as ImportRow | undefined;
    if (!due) return;

    // Shares the per-account lock with bulk profile enrichment (lib/linkedin/enrich.ts), so an
    // import pass never drives the session while a bulk enrich run is using it.
    const { acquireEnrichLock } = await import("@/lib/linkedin/enrich");
    const release = due.account_id ? acquireEnrichLock(`import:${due.list_id}`, due.account_id) : () => {};
    if (!release) return; // account busy - stays scheduled for the next pass

    try {
      const claimed = db.prepare(
        "UPDATE list_imports SET status = 'running', started_at = datetime('now'), heartbeat_at = datetime('now') WHERE id = ? AND status = 'scheduled'"
      ).run(due.id);
      if (!claimed.changes) return;
      await runBatch(due.id, Date.now() + (opts.budgetMs ?? IMPORT_PASS_BUDGET_MS));
    } finally {
      release();
    }
  } finally {
    importRunning = false;
  }
}

async function runBatch(importId: string, deadline: number): Promise<void> {
  const db = getDb();
  const job = db.prepare("SELECT * FROM list_imports WHERE id = ?").get(importId) as ImportRow | undefined;
  if (!job) return;
  if (!job.account_id || !job.sales_nav_url) {
    // Previously left 'running' forever, which also blocked every later import of the list.
    db.prepare("UPDATE list_imports SET status = 'error', error = 'Import has no LinkedIn account or Sales Navigator URL', finished_at = datetime('now') WHERE id = ?").run(importId);
    return;
  }

  // List deleted out from under us?
  const list = db.prepare("SELECT id, workspace_id FROM lists WHERE id = ?").get(job.list_id) as { id: string; workspace_id: string | null } | undefined;
  if (!list) {
    db.prepare("UPDATE list_imports SET status = 'canceled', finished_at = datetime('now') WHERE id = ?").run(importId);
    return;
  }

  // Today's remaining budget for THIS workspace → max whole pages this pass
  const cap = getDailyImportCap(db, list.workspace_id);
  const remaining = cap - importedToday(db, list.workspace_id);
  const quotaPages = Math.floor(remaining / PAGE_SIZE);
  if (quotaPages < 1) {
    db.prepare("UPDATE list_imports SET status = 'scheduled', scheduled_for = ?, heartbeat_at = NULL WHERE id = ?").run(
      addDaysStr(todayStr(), 1),
      importId
    );
    return;
  }
  const maxPages = Math.min(quotaPages, IMPORT_PAGES_PER_PASS);

  console.log(`[import] batch ${importId} (b${job.batch_index}) start_page=${job.start_page} maxPages=${maxPages} cap=${cap}`);
  const { getSessionContext } = await import("@/lib/linkedin/session");
  const { scrapeNavigatorUrl } = await import("@/lib/linkedin/scraper");

  const updateProgress = db.prepare(
    "UPDATE list_imports SET phase = ?, page = ?, total_pages = ?, count = ?, total = ?, heartbeat_at = datetime('now') WHERE id = ?"
  );
  const userCanceled = () => {
    const r = db.prepare("SELECT cancel_requested FROM list_imports WHERE id = ?").get(importId) as
      | { cancel_requested: number }
      | undefined;
    return !r || r.cancel_requested === 1; // row deleted (list cascade) or explicit cancel
  };
  // Polled between pages: stamps liveness, and ends the pass at the deadline so the LinkedIn
  // loop gets the session back. A deadline stop is a normal partial pass, not a cancel.
  const isCanceled = () => {
    db.prepare("UPDATE list_imports SET heartbeat_at = datetime('now') WHERE id = ?").run(importId);
    return userCanceled() || Date.now() > deadline;
  };

  try {
    const ctx = await getSessionContext(job.account_id);
    const { profiles, lastPage, knownTotal, exhausted } = await scrapeNavigatorUrl(ctx, job.sales_nav_url, {
      startPage: job.start_page,
      maxPages,
      onProgress: (p) => updateProgress.run(p.phase, p.page ?? 0, p.totalPages ?? 0, p.count, p.total, importId),
      isCanceled,
    });

    if (userCanceled()) {
      if (db.prepare("SELECT id FROM list_imports WHERE id = ?").get(importId)) {
        db.prepare("UPDATE list_imports SET status = 'canceled', finished_at = datetime('now') WHERE id = ?").run(importId);
      }
      return;
    }

    const { imported, skipped } = insertProfiles(db, job.list_id, profiles);
    console.log(`[import] batch ${importId} inserted ${imported} new, skipped ${skipped} (lastPage=${lastPage}, exhausted=${exhausted})`);

    // Close this batch and chain the remainder atomically: a crash between the two used to
    // leave a 'done' batch with no continuation, silently ending a half-imported list.
    db.transaction(() => {
      db.prepare(
        `UPDATE list_imports
           SET status = 'done', imported = ?, skipped = ?, count = ?, total = ?, page = ?, total_pages = ?, finished_at = datetime('now')
         WHERE id = ?`
      ).run(imported, skipped, profiles.length, knownTotal, lastPage, Math.ceil(knownTotal / PAGE_SIZE), importId);

      // More of the list left → chain the remainder: later today while quota remains, else tomorrow.
      if (!exhausted) {
        const quotaLeft = getDailyImportCap(db, list.workspace_id) - importedToday(db, list.workspace_id) >= PAGE_SIZE;
        db.prepare(
          `INSERT INTO list_imports
             (id, list_id, account_id, sales_nav_url, status, scheduled_for, start_page, batch_index, enrich, total, total_pages, started_at)
           VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          randomUUID(),
          job.list_id,
          job.account_id,
          job.sales_nav_url,
          quotaLeft ? todayStr() : addDaysStr(todayStr(), 1),
          lastPage + 1,
          job.batch_index + 1,
          job.enrich,
          knownTotal,
          Math.ceil(knownTotal / PAGE_SIZE)
        );
      }
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import] FAILED:", message);
    if (db.prepare("SELECT id FROM list_imports WHERE id = ?").get(importId)) {
      db.prepare("UPDATE list_imports SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?").run(
        message,
        importId
      );
    }
    // A "no data intercepted / re-authentication" failure means the session died.
    if (/re-authentication|No data intercepted/i.test(message) && job.account_id) {
      try {
        const { markNeedsReauth } = await import("@/lib/linkedin/session");
        await markNeedsReauth(job.account_id);
      } catch { /* ignore */ }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function insertProfiles(db: DB, listId: string, profiles: any[]): { imported: number; skipped: number } {
  const workspaceId = (db.prepare("SELECT workspace_id FROM lists WHERE id = ?").get(listId) as { workspace_id: string } | undefined)?.workspace_id;
  if (!workspaceId) throw new Error("List workspace not found");
  const insertTarget = db.prepare(
    `INSERT INTO targets (
       id, workspace_id, linkedin_url, sales_nav_url, first_name, last_name, full_name,
       title, company, location, degree,
       object_urn, summary, open_link, company_industry, company_location,
       tenure_months, spotlight_badges
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, linkedin_url) WHERE linkedin_url IS NOT NULL DO UPDATE SET
       sales_nav_url = excluded.sales_nav_url,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       full_name = excluded.full_name,
       title = excluded.title,
       company = excluded.company,
       location = excluded.location,
       degree = excluded.degree,
       object_urn = excluded.object_urn,
       summary = excluded.summary,
       open_link = excluded.open_link,
       company_industry = excluded.company_industry,
       company_location = excluded.company_location,
       tenure_months = excluded.tenure_months,
       spotlight_badges = excluded.spotlight_badges`
  );
  const insertLink = db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");
  const findTarget = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND linkedin_url = ?");

  let imported = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const p of profiles) {
      const url = p.linkedinUrl ?? p.salesNavUrl;
      insertTarget.run(
        randomUUID(), workspaceId, url, p.salesNavUrl,
        p.firstName, p.lastName, p.fullName,
        p.title, p.company, p.location, p.degree,
        p.objectUrn, p.summary, p.openLink ? 1 : 0,
        p.companyIndustry, p.companyLocation,
        p.tenureMonths, p.spotlightBadges
      );
      const target = findTarget.get(workspaceId, url) as { id: string };
      const result = insertLink.run(listId, target.id);
      if (result.changes > 0) imported++;
      else skipped++;
    }
  })();
  return { imported, skipped };
}
