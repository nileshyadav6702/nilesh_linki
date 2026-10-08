import type Database from "better-sqlite3";
import { execMigration, rebuildTable } from "@/lib/db/migrate";

/**
 * Schema for the AI SDR layer (ICP, agents, signal engine, approvals, enrichment).
 * See docs/prd/ai-signal-sdr-prd.md. Kept out of lib/db.ts so that file stops growing.
 *
 * Every statement is idempotent: CREATE ... IF NOT EXISTS, and ALTERs that throw on
 * re-run ("duplicate column name") are ignored via execMigration; any other error is rethrown.
 */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL, ok INTEGER NOT NULL DEFAULT 1,
    error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ai_usage_ws ON ai_usage(workspace_id, created_at)",

  `CREATE TABLE IF NOT EXISTS icps (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, website_url TEXT, data_json TEXT NOT NULL,
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, icp_id TEXT REFERENCES icps(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
    mode TEXT NOT NULL DEFAULT 'copilot' CHECK(mode IN ('copilot','autopilot')),
    min_score REAL NOT NULL DEFAULT 55, fit_weight REAL NOT NULL DEFAULT 0.6,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
    linkedin_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    email_account_id TEXT REFERENCES email_accounts(id) ON DELETE SET NULL,
    autopilot_delay_minutes INTEGER NOT NULL DEFAULT 60,
    daily_lead_cap INTEGER NOT NULL DEFAULT 25,
    enrich_emails INTEGER NOT NULL DEFAULT 1,
    booking_url TEXT, last_run_at TEXT, last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS agent_sources (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1, interval_hours REAL NOT NULL DEFAULT 12,
    last_run_at TEXT, next_run_at TEXT, cursor_json TEXT, last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_agent_sources_due ON agent_sources(enabled, next_run_at)",

  `CREATE TABLE IF NOT EXISTS detector_runs (
    id TEXT PRIMARY KEY, agent_source_id TEXT REFERENCES agent_sources(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT,
    candidates INTEGER NOT NULL DEFAULT 0, ingested INTEGER NOT NULL DEFAULT 0,
    filtered INTEGER NOT NULL DEFAULT 0, linkedin_requests INTEGER NOT NULL DEFAULT 0, error TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_detector_runs_source ON detector_runs(agent_source_id, started_at)",

  `CREATE TABLE IF NOT EXISTS approval_queue (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('linkedin_message','email')),
    subject TEXT, body TEXT NOT NULL, signal_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','consumed')),
    auto_approve_at TEXT, decided_by TEXT, decided_at TEXT, consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON approval_queue(workspace_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_approval_queue_target ON approval_queue(target_id, channel, status)",

  `CREATE TABLE IF NOT EXISTS linkedin_usage (
    account_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, day, kind)
  )`,

  `CREATE TABLE IF NOT EXISTS enrichment_cache (
    identity_key TEXT NOT NULL, provider TEXT NOT NULL, email TEXT, verified INTEGER NOT NULL DEFAULT 0,
    result_json TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (identity_key, provider)
  )`,

  `CREATE TABLE IF NOT EXISTS reply_drafts (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    reply_id TEXT NOT NULL, body TEXT NOT NULL, kind TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','discarded')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_reply_drafts_reply ON reply_drafts(reply_id)",

  `CREATE TABLE IF NOT EXISTS site_pixels (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS website_visits (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    page_url TEXT, referrer TEXT, company_domain TEXT, company_name TEXT, ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_website_visits_ws ON website_visits(workspace_id, created_at)",

  // Lead state on contacts.
  "ALTER TABLE targets ADD COLUMN fit_score REAL",
  "ALTER TABLE targets ADD COLUMN fit_verdict TEXT",
  "ALTER TABLE targets ADD COLUMN fit_reason TEXT",
  "ALTER TABLE targets ADD COLUMN fit_confidence TEXT",
  "ALTER TABLE targets ADD COLUMN lead_score REAL",
  "ALTER TABLE targets ADD COLUMN scored_at TEXT",
  "ALTER TABLE targets ADD COLUMN scored_icp_id TEXT",
  "ALTER TABLE targets ADD COLUMN lead_source TEXT",
  "ALTER TABLE targets ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL",
  "ALTER TABLE targets ADD COLUMN agent_status TEXT",
  "ALTER TABLE targets ADD COLUMN agent_status_at TEXT",
  "ALTER TABLE targets ADD COLUMN skip_reason TEXT",
  "CREATE INDEX IF NOT EXISTS idx_targets_agent ON targets(agent_id, agent_status)",
  "CREATE INDEX IF NOT EXISTS idx_targets_member_urn ON targets(workspace_id, linkedin_member_urn)",

  "ALTER TABLE meetings ADD COLUMN agent_id TEXT",
  "ALTER TABLE meetings ADD COLUMN signal_id TEXT",

  // Copilot: one draft per AI step of the campaign, not just the first touch.
  "ALTER TABLE approval_queue ADD COLUMN step_id TEXT",
  "ALTER TABLE approval_queue ADD COLUMN position INTEGER",
  "ALTER TABLE approval_queue ADD COLUMN updated_at TEXT",
  "CREATE INDEX IF NOT EXISTS idx_approval_queue_step ON approval_queue(target_id, step_id, status)",

  // Finding leads (agents.status) and outreach are separate switches.
  "ALTER TABLE agents ADD COLUMN outreach_enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agents ADD COLUMN goal TEXT NOT NULL DEFAULT 'conversations'",
  "ALTER TABLE agents ADD COLUMN tone TEXT NOT NULL DEFAULT 'professional'",
  "ALTER TABLE agents ADD COLUMN channel TEXT NOT NULL DEFAULT 'multi'",
  "ALTER TABLE agents ADD COLUMN exclude_first_degree INTEGER NOT NULL DEFAULT 1",
];

/** Agents created before the split were "active" for both discovery and outreach. */
function splitOutreachFlag(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM _migration_flags WHERE key = 'agents_outreach_split_v1'").get()) return;
  db.exec(`UPDATE agents SET outreach_enabled = 1 WHERE status = 'active';
    INSERT INTO _migration_flags (key) VALUES ('agents_outreach_split_v1');`);
}

/** signals.type had a CHECK limited to six types; rebuild once without it (validated in app). */
function widenSignalTypes(db: Database.Database) {
  const done = db.prepare("SELECT 1 FROM _migration_flags WHERE key = 'signals_open_types_v1'").get();
  if (done) return;
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'").get() as { sql: string } | undefined;
  if (!info) return;
  // Copies every column the old table shares with the new one (agent_id etc. included when a
  // previous partial run added them), inside one transaction with the flag write.
  rebuildTable(db, {
    table: "signals",
    tempTable: "signals_open",
    createTempSql: `CREATE TABLE signals_open (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE CASCADE, company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
      type TEXT NOT NULL, title TEXT NOT NULL, description TEXT, score REAL NOT NULL DEFAULT 0, source TEXT,
      occurred_at TEXT NOT NULL, metadata_json TEXT, processed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      agent_id TEXT, source_url TEXT, snippet TEXT, weight REAL, detector_run_id TEXT, dedupe_key TEXT
    )`,
    after: () => db.exec("INSERT INTO _migration_flags (key) VALUES ('signals_open_types_v1')"),
  });
}

export function runAiSdrMigrations(db: Database.Database): void {
  for (const sql of STATEMENTS) execMigration(db, sql);
  splitOutreachFlag(db);
  widenSignalTypes(db);
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(target_id, occurred_at)",
    "CREATE INDEX IF NOT EXISTS idx_signals_ws ON signals(workspace_id, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedupe ON signals(workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL",
  ]) execMigration(db, sql);
}
