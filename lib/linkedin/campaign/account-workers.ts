import { getDb } from "@/lib/db";
import type { ActiveLease } from "@/lib/email/infrastructure";
import { acquireAccountLease, type AccountLease } from "@/lib/linkedin/account-lease";
import { dropStaleSession } from "@/lib/linkedin/session";
import { recoverStaleLinkedinActions } from "@/lib/linkedin/actions";
import { guard, WatchdogTimeoutError } from "@/lib/watchdog";
import {
  BULK_ENRICH_TIMEOUT_MS, DISCOVERY_BUDGET_MS, DISCOVERY_TIMEOUT_MS, IMPORT_PASS_TIMEOUT_MS, NEEDS_DATA_TIMEOUT_MS, TICK_TIMEOUT_MS,
} from "./constants";
import { linkedInCampaignRuns } from "./runs";
import { tick } from "./tick";

/**
 * Per-account LinkedIn workers.
 *
 * Every LinkedIn account has its own browser context, daily caps and pacing, so one account's
 * backlog has no reason to wait behind another's. Each loop pass runs up to
 * LINKEDIN_ACCOUNT_CONCURRENCY accounts in parallel; WITHIN an account, everything that drives
 * its session runs strictly in sequence: due campaign steps (with the 8-20s gap between them),
 * then one bounded import pass, then a few needs-data profile reads, then one slice of a queued
 * bulk list enrichment, then that account's due AI-agent signal discovery (last, so outreach
 * always goes first; its own time budget, request quotas and 24h pause on a 429/999 apply).
 *
 * Exclusivity: an account is "busy" from the moment its unit starts until every promise it
 * started has settled — including a phase the watchdog abandoned on a timeout, which keeps
 * driving the browser in the background. A busy account is skipped by later passes, so one
 * account's session is never driven by two units at once. A timed-out phase also ends the
 * rest of that account's unit for this pass.
 *
 * Fencing: the loop holds the "linkedin-runner" lease and renews it; every phase re-checks
 * lease.isHeld() before it starts and the phases check it between steps/pages/profiles.
 *
 * Cross-process: "busy" above is per process. Whoever holds an account (a unit here, or
 * claimAccount() from a web route) also holds its DB lease `linkedin-account:<id>`
 * (account-lease.ts) until the account's last tracked promise settles, so the web process and
 * the worker process (LINKI_ROLE=web / worker) never drive one session at the same time.
 * Inside a unit, lease.isHeld() is also false once that account lease is lost.
 */

export const DEFAULT_ACCOUNT_CONCURRENCY = 4;
const MAX_ACCOUNT_CONCURRENCY = 16;

/** LINKEDIN_ACCOUNT_CONCURRENCY (default 4, clamped to 1..16). */
export function accountConcurrency(raw = process.env.LINKEDIN_ACCOUNT_CONCURRENCY): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ACCOUNT_CONCURRENCY;
  return Math.min(n, MAX_ACCOUNT_CONCURRENCY);
}

// Outstanding promises per account, and the DB lease held for each busy account. On globalThis
// so every bundle in the process shares them.
const state = globalThis as typeof globalThis & { __linkiAccountInflight?: Map<string, number>; __linkiAccountLeases?: Map<string, AccountLease> };
const inflight = (state.__linkiAccountInflight ??= new Map<string, number>());
const accountLeases = (state.__linkiAccountLeases ??= new Map<string, AccountLease>());

export function isAccountBusy(accountId: string): boolean {
  return (inflight.get(accountId) ?? 0) > 0;
}

/** Accounts with work still in flight (including abandoned, timed-out phases). */
export function busyAccountIds(): Set<string> {
  return new Set(Array.from(inflight.entries()).filter(([, n]) => n > 0).map(([id]) => id));
}

function track<T>(accountId: string, promise: Promise<T>): Promise<T> {
  inflight.set(accountId, (inflight.get(accountId) ?? 0) + 1);
  const done = () => {
    const n = (inflight.get(accountId) ?? 1) - 1;
    if (n > 0) { inflight.set(accountId, n); return; }
    inflight.delete(accountId);
    // Everything this process started on the account has settled: let other processes have it.
    const lease = accountLeases.get(accountId);
    accountLeases.delete(accountId);
    lease?.release();
  };
  promise.then(done, done);
  return promise;
}

export type HoldResult = { release: () => void; lease: AccountLease } | { busy: "local" | "remote" };

/**
 * Hold an account: busy in this process AND its DB lease, until the returned release() is
 * called and every promise tracked on the account has settled. Synchronous (better-sqlite3),
 * so the check and the claim cannot interleave with another holder in this process.
 */
export function holdAccount(accountId: string): HoldResult {
  if (isAccountBusy(accountId)) return { busy: "local" };
  const lease = acquireAccountLease(accountId);
  if (!lease) return { busy: "remote" };
  accountLeases.set(accountId, lease);
  let release!: () => void;
  void track(accountId, new Promise<void>((resolve) => { release = resolve; }));
  return { release, lease };
}

/**
 * Claim an account's session from outside the runner (wizard preview, manual syncs, login), so
 * no worker unit — in this process or the worker process — starts on it meanwhile. Returns a
 * release function, or null when the account is busy here or held by another process.
 */
export function claimAccount(accountId: string): (() => void) | null {
  const hold = holdAccount(accountId);
  return "busy" in hold ? null : hold.release;
}

export interface AccountPhase {
  label: string;
  timeoutMs: number;
  run: (accountId: string, lease: ActiveLease) => Promise<unknown>;
}

/** The phases of one account unit, in order. Injected in tests. */
export function defaultAccountPhases(db: ReturnType<typeof getDb> = getDb()): AccountPhase[] {
  return [
    { label: "Campaign tick", timeoutMs: TICK_TIMEOUT_MS, run: (accountId, lease) => tick(db, lease, accountId) },
    {
      label: "List import", timeoutMs: IMPORT_PASS_TIMEOUT_MS, run: async (accountId, lease) => {
        const { processScheduledImports } = await import("@/lib/import-jobs");
        await processScheduledImports(db, { accountId, shouldStop: () => !lease.isHeld() });
      },
    },
    {
      // Leads parked as needs_data (no headline/about to score): a few budgeted profile reads.
      label: "Needs-data enrichment", timeoutMs: NEEDS_DATA_TIMEOUT_MS, run: async (accountId, lease) => {
        const { enrichNeedsDataLeads } = await import("@/lib/linkedin/needs-data");
        await enrichNeedsDataLeads({}, undefined, { accountId, shouldStop: () => !lease.isHeld() });
      },
    },
    {
      label: "Bulk list enrichment", timeoutMs: BULK_ENRICH_TIMEOUT_MS, run: async (accountId, lease) => {
        const { processBulkEnrichSlice } = await import("@/lib/linkedin/bulk-enrich");
        await processBulkEnrichSlice(accountId, { shouldStop: () => !lease.isHeld() });
      },
    },
    {
      // AI-agent signal discovery for the agents that read through THIS account only.
      label: "Signal discovery", timeoutMs: DISCOVERY_TIMEOUT_MS, run: async (accountId, lease) => {
        const { runLinkedInDiscovery } = await import("@/lib/signals/linkedin-discovery");
        await runLinkedInDiscovery(DISCOVERY_BUDGET_MS, { accountId, shouldStop: () => !lease.isHeld() });
      },
    },
  ];
}

export type UnitOutcome = "done" | "busy" | "lease_lost" | "timed_out";

/** Run one account's phases in sequence. Never runs while the account still has work in flight. */
export async function runAccountUnit(accountId: string, runnerLease: ActiveLease, phases: AccountPhase[]): Promise<UnitOutcome> {
  // Holds the account busy (and its DB lease) for the whole unit, independently of the
  // per-phase promises.
  const hold = holdAccount(accountId);
  if ("busy" in hold) {
    console.warn(hold.busy === "local"
      ? `[runner] account ${accountId} still has work in flight from an earlier pass — skipping it this pass`
      : `[runner] account ${accountId} is in use by another process (web request or another worker) — skipping it this pass`);
    return "busy";
  }
  const lease: ActiveLease = { ...runnerLease, isHeld: () => runnerLease.isHeld() && hold.lease.isHeld() };
  try {
    // Another process may have saved newer cookies (login, wizard preview) since this
    // process opened its context for the account: start from the stored session.
    dropStaleSessionSafely(accountId);
    for (const phase of phases) {
      if (!lease.isHeld()) return "lease_lost";
      let timedOut = false;
      await guard(`${phase.label} (${accountId})`, phase.timeoutMs, () => track(accountId, phase.run(accountId, lease)), (err) => {
        if (err instanceof WatchdogTimeoutError) timedOut = true;
      });
      // The abandoned phase is still driving this account's browser: start nothing else on it.
      if (timedOut) return "timed_out";
    }
    return "done";
  } finally {
    hold.release();
  }
}

/** session.dropStaleSession (synchronous), tolerant of the session module being mocked in tests. */
export function dropStaleSessionSafely(accountId: string): void {
  try {
    dropStaleSession(accountId);
  } catch (err) {
    console.warn(`[runner] could not refresh the session of account ${accountId}:`, err instanceof Error ? err.message : err);
  }
}

/** Run `worker` over `ids` with at most `limit` in flight; stops starting new ones once `canStart` is false. */
export async function runPool(ids: string[], limit: number, worker: (id: string) => Promise<unknown>, canStart: () => boolean = () => true): Promise<void> {
  const queue = [...ids];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length > 0 && canStart()) {
      const id = queue.shift()!;
      try { await worker(id); } catch (err) {
        console.error(`[runner] account worker ${id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  });
  await Promise.all(runners);
}

/** Accounts with anything for a worker to do: campaign runs, due imports, needs-data leads, queued bulk enrichment, due signal discovery. */
export async function accountsWithLinkedinWork(db: ReturnType<typeof getDb>): Promise<string[]> {
  const { dueImportAccountIds } = await import("@/lib/import-jobs");
  const { needsDataAccounts } = await import("@/lib/linkedin/needs-data");
  const { bulkEnrichAccountIds } = await import("@/lib/linkedin/bulk-enrich");
  const { discoveryAccountIds } = await import("@/lib/signals/linkedin-discovery");
  const ids = new Set<string>();
  for (const run of linkedInCampaignRuns(db)) if (run.account_id) ids.add(run.account_id);
  for (const id of dueImportAccountIds(db)) ids.add(id);
  for (const id of needsDataAccounts(db)) ids.add(id);
  for (const id of bulkEnrichAccountIds(db)) ids.add(id);
  for (const id of discoveryAccountIds()) ids.add(id);
  return Array.from(ids);
}

export interface AccountPassOptions {
  accounts?: string[];
  phases?: AccountPhase[];
  concurrency?: number;
}

/** One pass of every account with work, LINKEDIN_ACCOUNT_CONCURRENCY at a time. */
export async function runAccountWorkers(db: ReturnType<typeof getDb>, lease: ActiveLease, opts: AccountPassOptions = {}): Promise<Map<string, UnitOutcome>> {
  const outcomes = new Map<string, UnitOutcome>();
  if (!lease.isHeld()) return outcomes;
  recoverStaleLinkedinActions(db);
  const { failAccountlessImports } = await import("@/lib/import-jobs");
  failAccountlessImports(db);
  const { flagAccountlessDiscoverySources } = await import("@/lib/signals/linkedin-discovery");
  flagAccountlessDiscoverySources();
  const accounts = opts.accounts ?? await accountsWithLinkedinWork(db);
  if (accounts.length === 0) return outcomes;
  const phases = opts.phases ?? defaultAccountPhases(db);
  await runPool(accounts, opts.concurrency ?? accountConcurrency(), async (accountId) => {
    outcomes.set(accountId, await runAccountUnit(accountId, lease, phases));
  }, () => lease.isHeld());
  return outcomes;
}
