import type Database from "better-sqlite3";
import { execMigration, rebuildTable, tableSql } from "@/lib/db/migrate";

/**
 * Schema for runner robustness: claim-before-send for LinkedIn actions, lease fencing,
 * atomic track claims, import heartbeats, needs_data enrichment attempts and the indexes the
 * runner's hot queries need. Idempotent; replayed on every boot after the other migrations.
 */
const STATEMENTS: string[] = [
  // Lead scoring v2 (lib/signals/scoring.ts): the model's signal + relevance judgements and the breakdown shown in the UI.
  "ALTER TABLE targets ADD COLUMN signal_strength REAL",
  "ALTER TABLE targets ADD COLUMN contact_relevance REAL",
  "ALTER TABLE targets ADD COLUMN score_breakdown TEXT",
  // AI message steps: which AI outreach template guides the writing (null = automatic, 'none' = no template).
  "ALTER TABLE workflow_steps ADD COLUMN ai_template_id TEXT",
  // Campaign settings: the language AI messages are written in (null = the user's account language) and split LinkedIn messages.
  "ALTER TABLE agents ADD COLUMN language TEXT",
  "ALTER TABLE agents ADD COLUMN split_messages INTEGER NOT NULL DEFAULT 0",
  // LinkedIn seat settings: country, weekly quotas (lib/linkedin/actions.ts applyWeeklyQuota), inbox filter and AI reply drafts.
  "ALTER TABLE accounts ADD COLUMN country TEXT",
  "ALTER TABLE accounts ADD COLUMN weekly_connection_limit INTEGER",
  "ALTER TABLE accounts ADD COLUMN weekly_message_limit INTEGER",
  "ALTER TABLE accounts ADD COLUMN weekly_visit_limit INTEGER",
  "ALTER TABLE accounts ADD COLUMN inbox_contacts_only INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN ai_draft_replies INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN booking_url TEXT",
  "ALTER TABLE accounts ADD COLUMN reply_instructions TEXT",
  // Company enrichment (lib/treg/company.ts): company-page firmographics and a cached funding lookup.
  "ALTER TABLE companies ADD COLUMN specialties TEXT",
  "ALTER TABLE companies ADD COLUMN org_type TEXT",
  "ALTER TABLE companies ADD COLUMN funding_checked_at TEXT",
  "ALTER TABLE companies ADD COLUMN last_funding_json TEXT",
  // Treg data calls (lib/treg/client.ts): what each workspace spends, for the daily cap and reporting.
  `CREATE TABLE IF NOT EXISTS treg_calls (
    id TEXT PRIMARY KEY, workspace_id TEXT, endpoint TEXT NOT NULL, purpose TEXT, status INTEGER,
    cost_micro INTEGER NOT NULL DEFAULT 0, served_by TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_treg_calls_ws_day ON treg_calls(workspace_id, created_at)",
  // Integrations page (lib/integrations): one connection per app; config holds the encrypted keys.
  `CREATE TABLE IF NOT EXISTS integration_connections (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, app TEXT NOT NULL,
    config_enc TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'connected',
    last_error TEXT, last_synced_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, app)
  )`,
  // Outbound sync queue: one row per lead (kind 'contact') or reply (kind 'reply', ref = message id) per app.
  `CREATE TABLE IF NOT EXISTS integration_syncs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, app TEXT NOT NULL,
    kind TEXT NOT NULL, target_id TEXT, ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, external_id TEXT, last_error TEXT,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT,
    UNIQUE(workspace_id, app, kind, ref)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_integration_syncs_due ON integration_syncs(status, next_attempt_at)",
  // Organization blocklist (lib/blocklist): company name shown next to a blocked domain.
  "ALTER TABLE suppressions ADD COLUMN label TEXT",
  // AI Competitor Filtering: one verdict per company, cached; "allowed" is the user's override.
  `CREATE TABLE IF NOT EXISTS competitor_checks (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, company_key TEXT NOT NULL,
    company_name TEXT, domain TEXT, is_competitor INTEGER NOT NULL DEFAULT 0, reason TEXT,
    allowed INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, company_key)
  )`,
  // Credits (lib/credits/ledger.ts): every grant, debit and refund; the balance is their sum.
  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT, type TEXT NOT NULL, credits INTEGER NOT NULL, units INTEGER,
    ref_id TEXT, provider TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_credit_ledger_ws ON credit_ledger(workspace_id, created_at)",
  `CREATE TABLE IF NOT EXISTS workspace_billing (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'trial', credits_per_seat INTEGER NOT NULL DEFAULT 200,
    cycle_start TEXT NOT NULL, next_refill_at TEXT NOT NULL, invoice_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // AI outreach templates (lib/ai-templates/store.ts): structure + instructions the AI writer follows.
  `CREATE TABLE IF NOT EXISTS ai_templates (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('linkedin','email')),
    kind TEXT NOT NULL CHECK(kind IN ('icebreaker','followup','closing')),
    subject TEXT, body TEXT NOT NULL DEFAULT '', ai_instructions TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ai_templates_ws ON ai_templates(workspace_id, channel, kind, updated_at)",
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
  // AI reply draft for the latest inbound message (lib/inbox/ai-draft.ts); ai_draft_for is that message's id.
  "ALTER TABLE inbox_threads ADD COLUMN ai_draft TEXT",
  "ALTER TABLE inbox_threads ADD COLUMN ai_draft_for TEXT",
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
  // Signal scheduler: one clock per tracked item (or per source when it has no items).
  `CREATE TABLE IF NOT EXISTS source_units (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES agent_sources(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, workspace_id TEXT NOT NULL, source_type TEXT NOT NULL, item_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','attention','waiting')),
    next_run_at TEXT NOT NULL, last_run_at TEXT, interval_hours REAL NOT NULL,
    yield_avg REAL, empty_runs INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, note TEXT, last_result_json TEXT, config_hash TEXT, icp_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(source_id, item_key)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_source_units_due ON source_units(next_run_at)",
  "CREATE INDEX IF NOT EXISTS idx_source_units_agent ON source_units(agent_id)",
  // Reads shared across agents for a few hours (two agents tracking the same competitor).
  "CREATE TABLE IF NOT EXISTS signal_read_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL)",
  "ALTER TABLE detector_runs ADD COLUMN item_key TEXT",
  // Data-provider cost per agent / signal / item / run (lib/treg/cost-context.ts).
  "ALTER TABLE treg_calls ADD COLUMN agent_id TEXT",
  "ALTER TABLE treg_calls ADD COLUMN source_id TEXT",
  "ALTER TABLE treg_calls ADD COLUMN source_type TEXT",
  "ALTER TABLE treg_calls ADD COLUMN item_key TEXT",
  "ALTER TABLE treg_calls ADD COLUMN run_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_treg_calls_agent_day ON treg_calls(agent_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_treg_calls_run ON treg_calls(run_id)",
  // Average data cost per run (micro-USD), for cost-aware cadence.
  "ALTER TABLE source_units ADD COLUMN cost_avg_micro REAL",
  // Per-agent daily data budget (USD); null = the default (AGENT_DATA_BUDGET_USD, $0.50).
  "ALTER TABLE agents ADD COLUMN daily_data_budget_usd REAL",
  // What the company's own homepage says it does (read once, free fetch), for scoring.
  "ALTER TABLE companies ADD COLUMN website_text TEXT",
  "ALTER TABLE companies ADD COLUMN website_fetched_at TEXT",
  // A mailbox the provider is throttling rests until this time (ISO) instead of failing contacts.
  "ALTER TABLE email_accounts ADD COLUMN cooldown_until TEXT",
  // Unexpected step errors retried per track before it fails (reset when the track advances).
  "ALTER TABLE run_profile_tracks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
  // LinkedIn's weekly invitation limit hit on this account: no invitations until then (ISO).
  "ALTER TABLE accounts ADD COLUMN connects_blocked_until TEXT",
  // The agent a campaign run belongs to (pause / resume / delete act on all of its runs).
  "ALTER TABLE runs ADD COLUMN agent_id TEXT",
  `UPDATE runs SET agent_id = (SELECT a.id FROM agents a WHERE a.workspace_id = runs.workspace_id AND a.workflow_id = runs.workflow_id AND a.list_id IS runs.list_id ORDER BY a.created_at LIMIT 1)
    WHERE agent_id IS NULL`,
  "CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id, status)",
  // Sender's postal address for the campaign email footer (CAN-SPAM).
  "ALTER TABLE email_accounts ADD COLUMN postal_address TEXT",
  // The text a message / InMail attempt carried, so a retry after a failed send reuses it
  // instead of paying the AI to write a different one.
  "ALTER TABLE linkedin_actions ADD COLUMN body TEXT",
  // Per-lead lookups on hot paths (reply stop, reply guard, threading, unsubscribe, bounce
  // matching, lead deletion) that otherwise scan the whole table.
  "CREATE INDEX IF NOT EXISTS idx_run_profiles_target ON run_profiles(target_id)",
  "CREATE INDEX IF NOT EXISTS idx_run_profiles_mailbox ON run_profiles(email_account_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_jobs_target ON email_jobs(target_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_email_jobs_run_target ON email_jobs(run_id, target_id)",
  "CREATE INDEX IF NOT EXISTS idx_sent_messages_recipient ON sent_messages(workspace_id, lower(recipient))",
  "CREATE INDEX IF NOT EXISTS idx_linkedin_actions_target ON linkedin_actions(target_id, account_id, type)",
  "CREATE INDEX IF NOT EXISTS idx_logs_target ON logs(target_id)",
  "CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, status)",
  // Why a lead is parked on its step right now (daily limit, outside hours, waiting to accept…),
  // shown next to it in the campaign. Cleared when it moves on.
  "ALTER TABLE run_profile_tracks ADD COLUMN wait_reason TEXT",
  // The browser fingerprint an account's LinkedIn session was born under (viewport, clock),
  // chosen at its login and reused for every later use. NULL = the original shared one.
  "ALTER TABLE accounts ADD COLUMN browser_profile TEXT",
  // When each member last marked their notifications read (the bell's "N new" and unread dots).
  `CREATE TABLE IF NOT EXISTS notification_reads (
    workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  // When a LinkedIn account was signed out / hit LinkedIn's weekly invitation limit (notifications).
  "ALTER TABLE accounts ADD COLUMN disconnected_at TEXT",
  "ALTER TABLE accounts ADD COLUMN connects_blocked_at TEXT",
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
