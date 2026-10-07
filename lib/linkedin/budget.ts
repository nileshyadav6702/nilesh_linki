import { getDb } from "@/lib/db";

/**
 * Per-account daily budgets for LinkedIn discovery traffic (signal detectors), kept
 * separate from — and much smaller than — what LinkedIn tolerates, so discovery never
 * costs a sending account. Outreach limits stay on the accounts table and are untouched.
 */
export const DISCOVERY_DAILY_LIMITS = {
  voyager_read: 120,
  search: 20,
  profile_view: 25,
} as const;

export type BudgetKind = keyof typeof DISCOVERY_DAILY_LIMITS;

/** Pause discovery on an account for this long after LinkedIn pushes back (429/challenge). */
export const BLOCK_PAUSE_HOURS = 24;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function usedToday(accountId: string, kind: BudgetKind): number {
  const row = getDb().prepare("SELECT count FROM linkedin_usage WHERE account_id = ? AND day = ? AND kind = ?").get(accountId, today(), kind) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function remaining(accountId: string, kind: BudgetKind): number {
  return Math.max(0, DISCOVERY_DAILY_LIMITS[kind] - usedToday(accountId, kind));
}

/** Reserve `n` units. Returns false (and reserves nothing) when it would exceed the budget. */
export function consume(accountId: string, kind: BudgetKind, n = 1): boolean {
  const db = getDb();
  return db.transaction(() => {
    if (usedToday(accountId, kind) + n > DISCOVERY_DAILY_LIMITS[kind]) return false;
    db.prepare(`INSERT INTO linkedin_usage (account_id, day, kind, count) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, day, kind) DO UPDATE SET count = count + excluded.count`).run(accountId, today(), kind, n);
    return true;
  })();
}

const pauseKey = (accountId: string) => `li_discovery_paused_until:${accountId}`;

export function pauseDiscovery(accountId: string, reason: string, hours = BLOCK_PAUSE_HOURS): void {
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();
  getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(pauseKey(accountId), JSON.stringify({ until, reason }));
}

export function discoveryPausedUntil(accountId: string): { until: string; reason: string } | null {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(pauseKey(accountId)) as { value: string } | undefined;
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as { until: string; reason: string };
    return Date.parse(v.until) > Date.now() ? v : null;
  } catch { return null; }
}

export function budgetSnapshot(accountId: string) {
  return {
    paused: discoveryPausedUntil(accountId),
    usage: Object.fromEntries((Object.keys(DISCOVERY_DAILY_LIMITS) as BudgetKind[]).map((k) => [k, { used: usedToday(accountId, k), limit: DISCOVERY_DAILY_LIMITS[k] }])),
  };
}
