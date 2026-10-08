import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { WORKER_ID, acquireLease, holdsLease, releaseLease, renewLease, type LeaseHandle } from "@/lib/email/infrastructure";

/**
 * Cross-process exclusion for one LinkedIn account's browser session.
 *
 * The in-memory claim (account-workers.ts) only excludes within one process. With the web
 * server and the background worker in separate processes (LINKI_ROLE=web / worker) both can
 * drive a LinkedIn session — the worker's account units, the web's wizard preview, manual
 * syncs and logins — so every holder of an account also takes the DB lease
 * `linkedin-account:<id>` in worker_leases (same table, fencing token and renewal as the
 * loop leases in lib/email/infrastructure.ts).
 *
 * Every acquisition gets its own owner id ("<WORKER_ID>:<random>"), so the lease excludes
 * holders inside one process as well, and a graceful shutdown can release all of a
 * process's account leases by owner prefix. The lease is renewed while held; if the process
 * dies it expires after ACCOUNT_LEASE_TTL_S and another process can take the account.
 */

export const ACCOUNT_LEASE_TTL_S = 60;
export const ACCOUNT_LEASE_RENEW_MS = 15_000;

export function accountLeaseName(accountId: string): string {
  return `linkedin-account:${accountId}`;
}

export interface AccountLease {
  readonly handle: LeaseHandle;
  /** Still the owner and not expired. False after a takeover or release. */
  isHeld(): boolean;
  /** Stop renewing and give the lease up. Idempotent. */
  release(): void;
}

export interface AccountLeaseOptions {
  /** Owner id; defaults to a fresh "<WORKER_ID>:<random>". */
  owner?: string;
  ttlSeconds?: number;
  renewEveryMs?: number;
}

/** Take the account's DB lease, or null when another live holder (any process) has it. Synchronous. */
export function acquireAccountLease(accountId: string, opts: AccountLeaseOptions = {}): AccountLease | null {
  const ttl = opts.ttlSeconds ?? ACCOUNT_LEASE_TTL_S;
  const owner = opts.owner ?? `${WORKER_ID}:${randomUUID().slice(0, 8)}`;
  const handle = acquireLease(accountLeaseName(accountId), owner, ttl);
  if (!handle) return null;
  let lost = false;
  let released = false;
  const timer = setInterval(() => {
    try {
      if (!renewLease(handle, ttl)) {
        lost = true;
        clearInterval(timer);
        console.warn(`[lease] ${handle.name} was taken over; this holder must stop driving the session`);
      }
    } catch (err) {
      console.warn(`[lease] ${handle.name} renewal failed:`, err instanceof Error ? err.message : err);
    }
  }, opts.renewEveryMs ?? ACCOUNT_LEASE_RENEW_MS);
  timer.unref?.();
  return {
    handle,
    isHeld: () => !released && !lost && holdsLease(handle),
    release: () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      try { releaseLease(handle); } catch (err) {
        console.warn(`[lease] ${handle.name} release failed (expires in ${ttl}s):`, err instanceof Error ? err.message : err);
      }
    },
  };
}

/** Who holds the account now (owner id), or null when it is free. For diagnostics and messages. */
export function accountLeaseHolder(accountId: string): string | null {
  const row = getDb().prepare("SELECT owner_id, expires_at FROM worker_leases WHERE name = ?").get(accountLeaseName(accountId)) as
    | { owner_id: string; expires_at: string } | undefined;
  return row && Date.parse(row.expires_at) > Date.now() ? row.owner_id : null;
}
