import { getDb } from "@/lib/db";
import { sourceNeedsLinkedIn } from "@/lib/agents/store";
import { getSessionContext, saveSessionState } from "@/lib/linkedin/session";
import { VoyagerClient, VoyagerBlockedError, VoyagerBudgetExceeded } from "@/lib/linkedin/voyager";
import { discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";
import { SOURCE_TYPES, type SourceType } from "@/lib/signals/types";
import { deferUnit, dueUnits, linkedInDueAccounts, nextLinkedInUnit, runUnit, syncUnits } from "@/lib/signals/scheduler";

/**
 * One discovery pass for LinkedIn-backed signal sources. Runs as the LAST phase of an
 * account's worker unit (lib/linkedin/campaign/account-workers.ts), so it is sequential with
 * that account's outreach on the same browser session, and bounded by `budgetMs` so outreach
 * is never starved. The signal scheduler (lib/signals/scheduler.ts) decides which unit runs:
 * one per account pass, spaced 10-20 minutes apart and paced over the account's working hours.
 * A 429/999 pauses discovery for that account only, for 24h.
 */

interface AccountRow { id: string; is_authenticated: number; active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null }

export interface DiscoveryOptions {
  /** Only sources whose agent reads through this LinkedIn account. */
  accountId?: string;
  /** Checked before the session is opened and between sources (lease fencing). */
  shouldStop?: () => boolean;
}

export function withinActiveHours(a: Pick<AccountRow, "active_hours_start" | "active_hours_end" | "timezone" | "working_days">, now = new Date()): boolean {
  const tz = a.timezone || "UTC";
  let hour: number; let weekday: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(now);
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? now.getUTCHours());
    weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Mon");
  } catch { hour = now.getUTCHours(); weekday = now.getUTCDay(); }
  const days = (a.working_days || "1,2,3,4,5").split(",").map(Number);
  if (!days.includes(weekday === 0 ? 7 : weekday) && !days.includes(weekday)) return false;
  const start = a.active_hours_start ?? 9;
  const end = a.active_hours_end ?? 18;
  return hour >= start && hour < end;
}

function loadAccount(accountId: string): AccountRow | undefined {
  return getDb().prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(accountId) as AccountRow | undefined;
}

/** Whether discovery may read through this account right now (signed in, not paused, in hours). */
function accountCanDiscover(account: AccountRow | undefined): account is AccountRow {
  return !!account?.is_authenticated && !discoveryPausedUntil(account.id) && withinActiveHours(account);
}

function linkedInSourceTypes(): SourceType[] {
  return (Object.keys(SOURCE_TYPES) as SourceType[]).filter((t) => sourceNeedsLinkedIn(t));
}

/**
 * Due LinkedIn units whose agent has no LinkedIn account: no account worker will ever pick them
 * up, so they are marked "needs attention" for the user and re-checked daily. Returns how many.
 */
export function flagAccountlessDiscoverySources(): number {
  const db = getDb();
  syncUnits(db);
  const types = new Set<string>(linkedInSourceTypes());
  let n = 0;
  for (const u of dueUnits(db, "linkedin").filter((x) => !x.linkedin_account_id && types.has(x.source_type))) {
    deferUnit(db, u.id, { ok: false, until: Date.now() + 24 * 3_600_000, state: "attention", note: "No LinkedIn account selected on this agent" });
    db.prepare("UPDATE agent_sources SET last_error = ? WHERE id = ?").run("No LinkedIn account selected on this agent", u.source_id);
    n++;
  }
  return n;
}

/** Accounts with a LinkedIn discovery unit allowed to run now: they get an account worker unit. */
export function discoveryAccountIds(): string[] {
  return linkedInDueAccounts().filter((id) => accountCanDiscover(loadAccount(id)));
}

export async function runLinkedInDiscovery(budgetMs = 4 * 60_000, opts: DiscoveryOptions = {}): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const shouldStop = opts.shouldStop ?? (() => false);
  if (opts.accountId === undefined) flagAccountlessDiscoverySources();
  const accounts = opts.accountId !== undefined ? [opts.accountId] : discoveryAccountIds();
  let ran = 0;
  for (const accountId of accounts) {
    if (Date.now() > deadline || shouldStop()) break;
    if (!accountCanDiscover(loadAccount(accountId))) continue;
    // One unit per pass: the next is at least 10 minutes later (scheduler spacing).
    const unit = nextLinkedInUnit(accountId);
    if (!unit || shouldStop()) continue;
    const ctx = await getSessionContext(accountId);
    const client = new VoyagerClient(ctx, accountId);
    try {
      const r = await runUnit(unit, { voyager: client, browser: ctx });
      ran++;
      console.log(`[signals] ${unit.source_type}${unit.item_key === "*" ? "" : ` (${unit.item_key})`}: ${r.ingested} new, ${r.candidates} seen${r.error ? ` — ${r.error}` : ""}`);
    } catch (err) {
      ran++;
      if (err instanceof VoyagerBlockedError) {
        pauseDiscovery(accountId, err.message);
        console.warn(`[signals] LinkedIn pushed back on account ${accountId} (${err.message}) — discovery paused 24h`);
      } else if (!(err instanceof VoyagerBudgetExceeded)) throw err;
    } finally {
      await client.close();
      await saveSessionState(accountId).catch(() => {});
    }
  }
  return ran;
}
