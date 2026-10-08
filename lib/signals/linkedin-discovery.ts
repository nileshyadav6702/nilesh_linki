import { getDb } from "@/lib/db";
import { getSessionContext, saveSessionState } from "@/lib/linkedin/session";
import { VoyagerClient, VoyagerBlockedError, VoyagerBudgetExceeded } from "@/lib/linkedin/voyager";
import { discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";
import { dueSources, runSource } from "@/lib/signals/engine";
import { SOURCE_TYPES, type SourceType } from "@/lib/signals/types";
import type { AgentSource } from "@/lib/agents/store";

/**
 * One discovery pass for LinkedIn-backed signal sources. Runs as the LAST phase of an
 * account's worker unit (lib/linkedin/campaign/account-workers.ts), so it is sequential with
 * that account's outreach on the same browser session, and bounded by `budgetMs` so outreach
 * is never starved. Each source keeps its own cadence (agent_sources.next_run_at), and a
 * 429/999 pauses discovery for that account only, for 24h.
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

function deferToTomorrow(sourceIds: string[]) {
  const stmt = getDb().prepare("UPDATE agent_sources SET next_run_at = datetime('now', '+12 hours') WHERE id = ?");
  for (const id of sourceIds) stmt.run(id);
}

function loadAccount(accountId: string): AccountRow | undefined {
  return getDb().prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(accountId) as AccountRow | undefined;
}

/** Whether discovery may read through this account right now (signed in, not paused, in hours). */
function accountCanDiscover(account: AccountRow | undefined): account is AccountRow {
  return !!account?.is_authenticated && !discoveryPausedUntil(account.id) && withinActiveHours(account);
}

function linkedInSourceTypes(): SourceType[] {
  return (Object.keys(SOURCE_TYPES) as SourceType[]).filter((t) => SOURCE_TYPES[t].needsLinkedIn);
}

/**
 * Due LinkedIn sources whose agent has no LinkedIn account: no account worker will ever pick
 * them up, so they are flagged for the user and pushed back 6h. Returns how many were flagged.
 */
export function flagAccountlessDiscoverySources(): number {
  const types = linkedInSourceTypes();
  return getDb().prepare(`UPDATE agent_sources SET last_error = ?, next_run_at = datetime('now', '+6 hours')
    WHERE enabled = 1 AND source_type IN (${types.map(() => "?").join(",")})
      AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
      AND agent_id IN (SELECT id FROM agents WHERE status = 'active' AND linkedin_account_id IS NULL)`)
    .run("No LinkedIn account selected on this agent", ...types).changes;
}

/** Accounts with due LinkedIn discovery work that may run now — they get an account worker unit. */
export function discoveryAccountIds(): string[] {
  const types = linkedInSourceTypes();
  const rows = getDb().prepare(`SELECT DISTINCT a.linkedin_account_id id FROM agent_sources s JOIN agents a ON a.id = s.agent_id
    WHERE s.enabled = 1 AND a.status = 'active' AND a.linkedin_account_id IS NOT NULL
      AND s.source_type IN (${types.map(() => "?").join(",")})
      AND (s.next_run_at IS NULL OR s.next_run_at <= datetime('now'))`).all(...types) as Array<{ id: string }>;
  return rows.map((r) => r.id).filter((id) => accountCanDiscover(loadAccount(id)));
}

export async function runLinkedInDiscovery(budgetMs = 4 * 60_000, opts: DiscoveryOptions = {}): Promise<number> {
  const db = getDb();
  const deadline = Date.now() + budgetMs;
  const shouldStop = opts.shouldStop ?? (() => false);
  const byAccount = new Map<string, AgentSource[]>();
  if (opts.accountId === undefined) flagAccountlessDiscoverySources();
  for (const s of dueSources("linkedin", 30, opts.accountId)) {
    const acc = (db.prepare("SELECT linkedin_account_id FROM agents WHERE id = ?").get(s.agent_id) as { linkedin_account_id: string | null } | undefined)?.linkedin_account_id;
    if (!acc) continue;
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc)!.push(s);
  }

  let ran = 0;
  for (const [accountId, sources] of byAccount) {
    if (Date.now() > deadline || shouldStop()) break;
    if (!accountCanDiscover(loadAccount(accountId))) continue;

    const ctx = await getSessionContext(accountId);
    const client = new VoyagerClient(ctx, accountId);
    try {
      for (let i = 0; i < sources.length; i++) {
        if (Date.now() > deadline || shouldStop()) break;
        try {
          const r = await runSource(sources[i], { voyager: client, browser: ctx });
          ran++;
          console.log(`[signals] ${sources[i].source_type}: ${r.ingested} new signal(s), ${r.filtered} filtered${r.error ? ` — ${r.error}` : ""}`);
        } catch (err) {
          if (err instanceof VoyagerBudgetExceeded) {
            deferToTomorrow(sources.slice(i).map((s) => s.id));
            break;
          }
          if (err instanceof VoyagerBlockedError) {
            pauseDiscovery(accountId, err.message);
            console.warn(`[signals] LinkedIn pushed back on account ${accountId} (${err.message}) — discovery paused 24h`);
            break;
          }
          throw err;
        }
      }
    } finally {
      await client.close();
      await saveSessionState(accountId).catch(() => {});
    }
  }
  return ran;
}
