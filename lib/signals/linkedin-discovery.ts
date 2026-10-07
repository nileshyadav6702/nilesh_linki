import { getDb } from "@/lib/db";
import { getSessionContext, saveSessionState } from "@/lib/linkedin/session";
import { VoyagerClient, VoyagerBlockedError, VoyagerBudgetExceeded } from "@/lib/linkedin/voyager";
import { discoveryPausedUntil, pauseDiscovery } from "@/lib/linkedin/budget";
import { dueSources, runSource } from "@/lib/signals/engine";
import type { AgentSource } from "@/lib/agents/store";

/**
 * One discovery pass for LinkedIn-backed signal sources. Called from the runner's
 * LinkedIn loop AFTER the campaign tick, so it never runs concurrently with outreach on
 * the same browser session, and bounded by `budgetMs` so outreach is never starved.
 */

interface AccountRow { id: string; is_authenticated: number; active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null }

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

export async function runLinkedInDiscovery(budgetMs = 4 * 60_000): Promise<number> {
  const db = getDb();
  const deadline = Date.now() + budgetMs;
  const byAccount = new Map<string, AgentSource[]>();
  for (const s of dueSources("linkedin", 30)) {
    const acc = (db.prepare("SELECT linkedin_account_id FROM agents WHERE id = ?").get(s.agent_id) as { linkedin_account_id: string | null } | undefined)?.linkedin_account_id;
    if (!acc) {
      db.prepare("UPDATE agent_sources SET last_error = ?, next_run_at = datetime('now', '+6 hours') WHERE id = ?").run("No LinkedIn account selected on this agent", s.id);
      continue;
    }
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc)!.push(s);
  }

  let ran = 0;
  for (const [accountId, sources] of byAccount) {
    if (Date.now() > deadline) break;
    const account = db.prepare("SELECT id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days FROM accounts WHERE id = ?").get(accountId) as AccountRow | undefined;
    if (!account?.is_authenticated || discoveryPausedUntil(accountId) || !withinActiveHours(account)) continue;

    const ctx = await getSessionContext(accountId);
    const client = new VoyagerClient(ctx, accountId);
    try {
      for (let i = 0; i < sources.length; i++) {
        if (Date.now() > deadline) break;
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
