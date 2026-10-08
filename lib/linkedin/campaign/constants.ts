// Tunables for the campaign runner: pacing, poll cadence and watchdog budgets.

// Minimum gap between Sales Nav profile enrichment calls per account (ms)
export const SALES_NAV_ENRICH_MIN_GAP_MS = 5 * 60 * 1000;

// Initial wait before first acceptance check (6h)
export const CONNECTION_RECHECK_HOURS = 6;
// Max days to wait for acceptance before giving up
export const CONNECTION_MAX_WAIT_DAYS = 7;
// Delay between profiles (seconds)
export const PROFILE_DELAY_MIN = 8;
export const PROFILE_DELAY_MAX = 20;
// Poll interval (ms)
export const POLL_INTERVAL_MS = 30_000;

// Watchdog budgets. Every network/browser await on a runner loop gets one: the loops are
// sequential, so a single promise that never settles halts everything downstream of it with
// no error and no log line. These are deliberately generous — they exist to break a hang,
// not to cut short slow-but-progressing work. Playwright's own 30s per-action timeouts sit
// under EXECUTE_STEP_TIMEOUT_MS.
export const INBOX_SYNC_TIMEOUT_MS = 60_000;
export const REPLY_SYNC_TIMEOUT_MS = 60_000;
export const ACCEPTED_SYNC_TIMEOUT_MS = 180_000;
export const CONNECTION_SYNC_TIMEOUT_MS = 120_000;
export const EXECUTE_STEP_TIMEOUT_MS = 300_000;
// Discovery stops starting new sources after DISCOVERY_BUDGET_MS; the timeout is the backstop.
export const DISCOVERY_BUDGET_MS = 4 * 60_000;
export const DISCOVERY_TIMEOUT_MS = 8 * 60_000;

// How long a tick may keep starting new profiles. Checked BETWEEN profiles, so the tick
// always ends on a clean boundary and the remainder simply stays due for the next pass.
// This is the mechanism that bounds a normal, busy tick.
export const TICK_SOFT_BUDGET_MS = 8 * 60_000;
// Email has no browser delay. The budget only yields the loop between steps so one
// mailbox's verification probe cannot pin the email worker for the whole poll.
export const EMAIL_TICK_SOFT_BUDGET_MS = 2 * 60_000;
// Hard backstop, and only that. It must stay well clear of a legitimate tick
// (TICK_SOFT_BUDGET_MS plus the one step that may still be running under its own deadline),
// because aborting here does NOT cancel the work: withTimeout stops the caller waiting while
// the orphaned step keeps driving the browser, so a premature fire would put two ticks on one
// LinkedIn session. An earlier 15-minute value did exactly that to a tick that was busy, not
// stuck — it fired while connection requests were still going out.
export const TICK_TIMEOUT_MS = 30 * 60_000;
// One bounded import pass (IMPORT_PASS_BUDGET_MS cooperative stop + the page in flight).
export const IMPORT_PASS_TIMEOUT_MS = 15 * 60_000;
export const NEEDS_DATA_TIMEOUT_MS = 5 * 60_000;
// AI writing blocked on the user (no key/model, out of credit, spend cap): the step is held,
// not skipped, and retried after this long.
export const AI_BLOCKED_RETRY_HOURS = 6;

// Floor on the gap between two sends from the SAME email account, plus jitter so the
// spacing is not uniform. Uniform gaps are themselves a detectable automation signature.
export const MIN_EMAIL_GAP_MS = 4 * 60_000;
export const EMAIL_GAP_JITTER_MS = 90_000;

// How long a pre-send mailbox check stands before it is worth paying for again. Long enough
// that a multi-step sequence probes each address once, short enough that a mailbox closed
// mid-campaign is caught before the later follow-ups.
export const EMAIL_RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60_000;
