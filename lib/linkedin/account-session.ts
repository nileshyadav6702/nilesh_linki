import { claimAccount, dropStaleSessionSafely } from "@/lib/linkedin/campaign/account-workers";
import { parkSession } from "@/lib/linkedin/session";
import { isSplitWeb } from "@/lib/runtime/role";

/**
 * Drive one LinkedIn account's session from a web request (wizard preview, manual stats /
 * accepted-invitation / list-degree syncs, live profile read, login steps).
 *
 * Takes the account exactly like a runner unit does (in-process claim + the cross-process DB
 * lease `linkedin-account:<id>`), so the request never drives the session alongside the
 * worker. Before running it drops this process's context when the stored session changed in
 * the other process. In the split deployment (LINKI_ROLE=web) it saves and closes the context
 * BEFORE letting go of the account, so the web never keeps a live context the worker could
 * race with; in the single-process mode the context stays open for the runner, as before.
 *
 * Throws AccountBusyError when the account is in use (a runner unit here or in the worker).
 */
export class AccountBusyError extends Error {
  readonly accountId: string;
  constructor(accountId: string) {
    super("This LinkedIn account is busy with other work right now (outreach, an import or a sync). Try again in a few minutes.");
    this.name = "AccountBusyError";
    this.accountId = accountId;
  }
}

export async function withAccountSession<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const release = claimAccount(accountId);
  if (!release) throw new AccountBusyError(accountId);
  try {
    dropStaleSessionSafely(accountId);
    return await fn();
  } finally {
    try {
      if (isSplitWeb()) await parkSession(accountId);
    } catch (err) {
      console.warn(`[session] could not close the web context for account ${accountId}:`, err instanceof Error ? err.message : err);
    } finally {
      release();
    }
  }
}
