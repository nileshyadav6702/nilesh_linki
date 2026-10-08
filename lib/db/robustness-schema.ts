import type Database from "better-sqlite3";
import { execMigration } from "@/lib/db/migrate";

/**
 * Schema for runner robustness: claim-before-send for LinkedIn actions, lease fencing,
 * atomic track claims, import heartbeats, needs_data enrichment attempts and the indexes the
 * runner's hot queries need. Idempotent; replayed on every boot after the other migrations.
 */
const STATEMENTS: string[] = [
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

export function runRobustnessMigrations(db: Database.Database): void {
  for (const sql of STATEMENTS) execMigration(db, sql);
}
