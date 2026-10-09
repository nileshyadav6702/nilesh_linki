import type Database from "better-sqlite3";
import { execMigration, rebuildTable, tableSql } from "@/lib/db/migrate";

/**
 * Schema for runner robustness: claim-before-send for LinkedIn actions, lease fencing,
 * atomic track claims, import heartbeats, needs_data enrichment attempts and the indexes the
 * runner's hot queries need. Idempotent; replayed on every boot after the other migrations.
 */
const STATEMENTS: string[] = [
  // Personal account settings (lib/user-profile.ts).
  "ALTER TABLE users ADD COLUMN first_name TEXT",
  "ALTER TABLE users ADD COLUMN last_name TEXT",
  "ALTER TABLE users ADD COLUMN language TEXT",
  "ALTER TABLE users ADD COLUMN timezone TEXT",
  "ALTER TABLE users ADD COLUMN daily_digest INTEGER NOT NULL DEFAULT 1",
  // Shareable workspace invite link (lib/workspace-join-links.ts).
  `CREATE TABLE IF NOT EXISTS workspace_join_links (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_join_links_ws ON workspace_join_links(workspace_id, revoked_at)",
  // Unified inbox: every LinkedIn conversation and mailbox thread of the workspace's
  // connected accounts, synced in (not only campaign replies), with local triage state.
  `CREATE TABLE IF NOT EXISTS inbox_threads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('linkedin','email')),
    account_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url TEXT,
    subject TEXT,
    participant_name TEXT,
    participant_headline TEXT,
    participant_email TEXT,
    participant_url TEXT,
    participant_photo TEXT,
    target_id TEXT,
    snippet TEXT,
    last_message_at TEXT,
    has_inbound INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    interested INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    messages_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(channel, account_id, external_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inbox_threads_list ON inbox_threads(workspace_id, deleted, last_message_at)",
  `CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    sender_name TEXT,
    sender_email TEXT,
    body_text TEXT,
    body_html TEXT,
    sent_at TEXT NOT NULL,
    UNIQUE(thread_id, external_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON inbox_messages(thread_id, sent_at)",
  `CREATE TABLE IF NOT EXISTS inbox_sync_state (
    account_kind TEXT NOT NULL,
    account_id TEXT NOT NULL,
    synced_at TEXT,
    error TEXT,
    PRIMARY KEY (account_kind, account_id)
  )`,
  // Deep research of a list: one run per request (criteria, progress), one result per contact.
  `CREATE TABLE IF NOT EXISTS list_research (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','failed')),
    total INTEGER NOT NULL DEFAULT 0,
    done_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_list_research_list ON list_research(list_id, started_at)",
  `CREATE TABLE IF NOT EXISTS target_research (
    target_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK(verdict IN ('match','no_match','unknown')),
    summary TEXT,
    researched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (target_id, list_id)
  )`,
  // One row per LinkedIn outreach action, claimed BEFORE the browser is driven. The unique
  // idempotency key is what stops a timed-out or crashed step from sending twice: a row left
  // in 'sending' is never retried automatically, it becomes 'uncertain' for a human to check.
  // Also the structured source for daily caps (logs wording is not a counter).
  `CREATE TABLE IF NOT EXISTS linkedin_actions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    account_id TEXT,
    run_id TEXT,
    track_id TEXT,
    step_id TEXT,
    target_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('connect','message','inmail','visit')),
    status TEXT NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed','uncertain')),
    attempt INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_linkedin_actions_caps ON linkedin_actions(account_id, type, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_linkedin_actions_track ON linkedin_actions(track_id, status)",

  // Lease fencing token: bumped whenever a lease changes hands.
  "ALTER TABLE worker_leases ADD COLUMN token INTEGER NOT NULL DEFAULT 0",

  // Atomic per-track claim so two processes can never execute the same track at once.
  "ALTER TABLE run_profile_tracks ADD COLUMN claimed_by TEXT",
  "ALTER TABLE run_profile_tracks ADD COLUMN claimed_at TEXT",

  // Import liveness: a 'running' import whose heartbeat is old is stale, not active.
  "ALTER TABLE list_imports ADD COLUMN heartbeat_at TEXT",

  // Bounded profile enrichment for leads parked as needs_data (missing headline + about).
  "ALTER TABLE targets ADD COLUMN profile_enrich_attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE targets ADD COLUMN profile_enrich_attempted_at TEXT",

  // Hot-path indexes.
  "CREATE INDEX IF NOT EXISTS idx_logs_run_created ON logs(run_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_run_profile_tracks_state_next ON run_profile_tracks(state, next_step_at)",
  "CREATE INDEX IF NOT EXISTS idx_sent_messages_account_day ON sent_messages(email_account_id, accepted_at)",
  "CREATE INDEX IF NOT EXISTS idx_email_jobs_account_status ON email_jobs(email_account_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_targets_workspace_lower_email ON targets(workspace_id, lower(email))",
  "CREATE INDEX IF NOT EXISTS idx_targets_needs_data ON targets(agent_status, enriched_profile_at)",
  "CREATE INDEX IF NOT EXISTS idx_list_imports_list_status ON list_imports(list_id, status)",
];

/** Every LinkedIn action the runner records (like = Like Posts step, voice = voice message, withdraw = stale invitation). */
export const LINKEDIN_ACTION_TYPES = ["connect", "message", "inmail", "visit", "like", "voice", "withdraw"];

/** Widen linkedin_actions.type's CHECK in place, keeping every column and row. True when it rebuilt. */
function widenLinkedinActionTypes(db: Database.Database): boolean {
  const sql = tableSql(db, "linkedin_actions");
  if (!sql || LINKEDIN_ACTION_TYPES.every((t) => sql.includes(`'${t}'`))) return false;
  const check = /CHECK\s*\(\s*type\s+IN\s*\([^)]*\)\s*\)/i;
  if (!check.test(sql)) throw new Error("linkedin_actions has no recognisable type CHECK to widen");
  const createTempSql = sql
    .replace(/^CREATE TABLE\s+("?)linkedin_actions\1/i, "CREATE TABLE linkedin_actions_new")
    .replace(check, `CHECK(type IN (${LINKEDIN_ACTION_TYPES.map((t) => `'${t}'`).join(",")}))`);
  rebuildTable(db, { table: "linkedin_actions", tempTable: "linkedin_actions_new", createTempSql });
  return true;
}

export function runRobustnessMigrations(db: Database.Database): void {
  for (const sql of STATEMENTS) execMigration(db, sql);
  // A rebuild drops the table's indexes; the statements are idempotent, so run them again.
  if (widenLinkedinActionTypes(db)) for (const sql of STATEMENTS) execMigration(db, sql);
}
