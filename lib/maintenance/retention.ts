import type Database from "better-sqlite3";

/**
 * Data retention for append-only tables that otherwise grow forever.
 *
 * Deletes in bounded batches (rowid IN (SELECT ... LIMIT n)) so no single statement holds the
 * write lock for long, yields to the event loop between batches, and stops at a time budget;
 * the next daily pass picks up whatever is left. Finishes with PRAGMA optimize (never VACUUM:
 * it rewrites the whole file under an exclusive lock).
 *
 * Rows are rowid-ordered roughly by insertion time, so the oldest (deletable) rows are found at
 * the start of each scan even where created_at has no dedicated index.
 *
 * Deliberately NOT pruned (business data, or read by caps / dedupe / idempotency):
 *   sent_messages, email_jobs, email_replies, linkedin_actions, approval_queue, reply_drafts,
 *   targets/companies/lists, activity_logs and todos (user-entered), signals, enrichment_cache
 *   (paid lookups), oauth_tokens (refresh-reuse detection), warmup_messages (lifetime engagement
 *   counts), search_filter_cache (lookup cache, no expiry semantics).
 */

export interface RetentionRule {
  table: string;
  /** Column compared with the cutoff. */
  column: string;
  /** Rows whose column is older than this many days are eligible. */
  days: number;
  /** Extra SQL conditions (ANDed). Alias the table as "x" when referring to its columns. */
  where?: string;
  /** Why this table and this window: shown in docs only. */
  note: string;
}

/**
 * Opt-in: null (keep logs forever) unless LOG_RETENTION_DAYS is set. The dashboard and
 * workflow analytics count lifetime sends/replies from logs, so pruning by default would
 * silently shrink those numbers.
 */
export function logRetentionDays(): number | null {
  const n = Number(process.env.LOG_RETENTION_DAYS);
  return process.env.LOG_RETENTION_DAYS && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/** The retention policy, one rule per table. Order matters where tables cascade. */
export function retentionRules(logDays: number | null = logRetentionDays()): RetentionRule[] {
  const logRule: RetentionRule[] = logDays === null ? [] : [
    { table: "logs", column: "created_at", days: logDays,
      note: "Run/step log lines, only when LOG_RETENTION_DAYS is set. Caps read linkedin_actions; dashboard/workflow log-derived counts only cover the window afterwards." },
  ];
  return [
    ...logRule,
    { table: "ai_usage", column: "created_at", days: 180,
      note: "Per-call AI usage. The spend cap only reads today; 180 days keeps cost history." },
    { table: "agent_sessions", column: "created_at", days: 180,
      note: "Sequence-writer prompts and outputs (large). The spend cap only reads today." },
    { table: "linkedin_usage", column: "day", days: 90,
      note: "Day-keyed LinkedIn API counters; budgets only read today." },
    { table: "detector_runs", column: "started_at", days: 365,
      note: "Signal detector run history; agent source totals then cover the last year." },
    { table: "website_visits", column: "created_at", days: 180,
      note: "Pixel hits; the UI shows the last 30 days." },
    { table: "mcp_audit_logs", column: "created_at", days: 90,
      note: "MCP tool call audit." },
    { table: "audit_logs", column: "created_at", days: 365,
      note: "Workspace audit trail; kept a full year." },
    { table: "sender_events", column: "created_at", days: 365,
      note: "Provider delivery/bounce events; analytics then cover a year. Bounces/suppressions live elsewhere." },
    { table: "provider_webhook_receipts", column: "received_at", days: 90,
      note: "Webhook replay keys; providers do not replay after days." },
    { table: "webhook_deliveries", column: "created_at", days: 30, where: "x.status IN ('delivered','dead_letter')",
      note: "Outbound webhook attempts in a final state only; pending/retrying are kept." },
    { table: "domain_events", column: "occurred_at", days: 90,
      where: "NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = x.id AND d.status NOT IN ('delivered','dead_letter'))",
      note: "Event log / API events feed. Events with an unfinished webhook delivery are kept (deleting would cascade it)." },
    { table: "deliverability_checks", column: "checked_at", days: 180,
      where: "EXISTS (SELECT 1 FROM deliverability_checks n WHERE n.workspace_id = x.workspace_id AND n.domain = x.domain AND n.checked_at > x.checked_at)",
      note: "DNS checks; the newest check per workspace+domain is always kept (the UI shows it)." },
    { table: "mail_oauth_states", column: "expires_at", days: 1,
      note: "Expired OAuth state nonces." },
    { table: "oauth_auth_codes", column: "expires_at", days: 1,
      note: "Expired single-use MCP OAuth codes." },
  ];
}

export interface RetentionOptions {
  /** Rows per DELETE statement. Default 5000. */
  batchSize?: number;
  /** Stop starting new batches after this long. Default 30s. */
  timeBudgetMs?: number;
  /** Override the policy (tests, one-off cleanups). */
  rules?: RetentionRule[];
  /** Run PRAGMA optimize afterwards. Default true. */
  optimize?: boolean;
}

export interface RetentionResult {
  deleted: Record<string, number>;
  errors: Record<string, string>;
  /** True when the time budget ran out before every table was drained. */
  truncated: boolean;
  ms: number;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

export async function runRetention(db: Database.Database, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const started = Date.now();
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 5000));
  const budget = opts.timeBudgetMs ?? 30_000;
  const result: RetentionResult = { deleted: {}, errors: {}, truncated: false, ms: 0 };

  for (const rule of opts.rules ?? retentionRules()) {
    if (!IDENT.test(rule.table) || !IDENT.test(rule.column)) { result.errors[rule.table] = "invalid identifier"; continue; }
    if (Date.now() - started >= budget) { result.truncated = true; break; }
    try {
      if (!tableExists(db, rule.table)) continue;
      const stmt = db.prepare(`DELETE FROM ${rule.table} WHERE rowid IN (
        SELECT x.rowid FROM ${rule.table} x
         WHERE x.${rule.column} IS NOT NULL AND x.${rule.column} < datetime('now', ?)${rule.where ? ` AND (${rule.where})` : ""}
         LIMIT ?)`);
      const offset = `-${Math.max(0, Math.floor(rule.days))} days`;
      let total = 0;
      for (;;) {
        const { changes } = stmt.run(offset, batchSize);
        total += changes;
        if (changes < batchSize) break;
        if (Date.now() - started >= budget) { result.truncated = true; break; }
        await yieldToLoop();
      }
      if (total) result.deleted[rule.table] = total;
    } catch (err) {
      result.errors[rule.table] = err instanceof Error ? err.message : String(err);
    }
    if (result.truncated) break;
  }

  if (opts.optimize !== false) {
    try { db.pragma("optimize"); } catch (err) { result.errors.optimize = err instanceof Error ? err.message : String(err); }
  }
  result.ms = Date.now() - started;
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;
let scheduled = false;

/**
 * Runs retention shortly after boot and then once a day in this process. Idempotent: a second
 * call is a no-op. The timers are unref'd so they never keep the process alive.
 */
export function startRetentionSchedule(getDb?: () => Database.Database): void {
  if (scheduled) return;
  scheduled = true;
  const run = async () => {
    try {
      const db = getDb ? getDb() : (await import("@/lib/db")).getDb();
      const r = await runRetention(db);
      const n = Object.values(r.deleted).reduce((a, b) => a + b, 0);
      if (n || Object.keys(r.errors).length) console.log(`[retention] deleted ${n} rows in ${r.ms}ms`, r.deleted, Object.keys(r.errors).length ? r.errors : "", r.truncated ? "(budget reached, continues tomorrow)" : "");
    } catch (err) {
      console.warn("[retention] pass failed:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(run, 5 * 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
}

/** Test hook. */
export function _resetRetentionScheduleForTests(): void { scheduled = false; }
