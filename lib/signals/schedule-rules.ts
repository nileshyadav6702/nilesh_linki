/**
 * Pure rules of the signal scheduler (lib/signals/scheduler.ts): how often each signal runs,
 * how that adapts to results, jitter, backoff after errors, error classes and run priority.
 * No DB or Node imports, so every rule is unit-tested on its own.
 */

const HOUR = 3_600_000;

/** Base cadence per source type, from how fast its data changes. */
export const BASE_CADENCE_HOURS: Record<string, number> = {
  own_content_engagement: 6,
  competitor_engagement: 8,
  influencer_engagement: 8,
  keyword_engagement: 12,
  profile_visitors: 12,
  funding: 12,
  job_change: 24,
  new_decision_maker: 24,
  hiring: 24,
  hiring_surge: 24,
  company_followers: 24,
  lookalike: 24,
  existing_list: 24,
  linkedin_import: 24,
  top_active: 72,
  tech_stack: 168,
};
export const DEFAULT_CADENCE_HOURS = 12;

/** Sources whose tracked items each get their own clock (one read per page / topic / board). */
export const PER_ITEM_TYPES = new Set(["competitor_engagement", "influencer_engagement", "own_content_engagement", "keyword_engagement", "hiring", "existing_list"]);

/** Intent order for first runs and for sharing a tight budget (higher runs first). */
export const INTENT: Record<string, number> = {
  own_content_engagement: 100, profile_visitors: 95, company_followers: 85, competitor_engagement: 80, new_decision_maker: 70,
  job_change: 65, influencer_engagement: 60, keyword_engagement: 55, funding: 50, hiring_surge: 50, hiring: 45,
  top_active: 40, tech_stack: 35, existing_list: 30, linkedin_import: 30, lookalike: 20,
};
/** Low-intent sources that pause when the agent has no room for more leads. */
export const FILLER_TYPES = new Set(["lookalike", "top_active", "tech_stack"]);

export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 3;
export const JITTER = 0.15;
/** Qualified leads per run that count as "productive" (cadence speeds up towards MIN_FACTOR). */
export const PRODUCTIVE_YIELD = 10;
const EWMA_ALPHA = 0.4;

export function baseCadence(type: string): number {
  return BASE_CADENCE_HOURS[type] ?? DEFAULT_CADENCE_HOURS;
}

/** Running average of qualified leads per run. */
export function nextYield(prev: number | null, qualified: number): number {
  return prev === null ? qualified : prev + EWMA_ALPHA * (qualified - prev);
}

/**
 * Effective interval: productive items run more often (down to 0.5× base), items that keep
 * finding nobody slow down (×1.5 per empty run after the second, up to 3× base).
 */
export function adaptiveInterval(type: string, yieldAvg: number | null, emptyRuns: number): number {
  const base = baseCadence(type);
  let factor = 1;
  if (emptyRuns >= 3) factor = Math.min(MAX_FACTOR, 1.5 ** (emptyRuns - 2));
  else if (yieldAvg !== null && yieldAvg > 0) factor = Math.max(MIN_FACTOR, 1 - 0.5 * Math.min(1, yieldAvg / PRODUCTIVE_YIELD));
  return Math.round(base * factor * 100) / 100;
}

/** ±15% so cadences drift apart instead of firing together. `rand` in [0,1). */
export function jittered(hours: number, rand = Math.random()): number {
  return hours * (1 - JITTER + 2 * JITTER * rand);
}

export type ErrorClass = "transient" | "config" | "budget" | "blocked";

const CONFIG_PATTERNS = [
  /needs (a|an) (connected|authenticated) linkedin account/i, /no linkedin account/i, /premium/i, /only admins/i, /add (at least one|your company page|persona job titles|a keyword)/i,
  /set up the agent's targeting/i, /balance is empty|rejected the api key|isn't configured/i, /needs the people database/i, /watches the job boards/i, /not implemented/i, /not a .*url/i,
];

export function classifyError(message: string, name = ""): ErrorClass {
  if (/VoyagerBlockedError/.test(name) || /\b(429|999)\b|pushed back/i.test(message)) return "blocked";
  if (/VoyagerBudgetExceeded/.test(name) || /budget reached|budget exceeded|voyager_read|data budget of/i.test(message)) return "budget";
  if (CONFIG_PATTERNS.some((re) => re.test(message))) return "config";
  return "transient";
}

/** Retry delay after the n-th consecutive transient failure: 15m, 30m, 1h, 2h… never past the cadence. */
export function backoffHours(failCount: number, cadenceHours: number): number {
  return Math.min(cadenceHours, 0.25 * 2 ** Math.max(0, failCount - 1));
}

/** How often a unit needing attention re-checks its setup. */
export const ATTENTION_RECHECK_HOURS = 24;

/** Order of due units: intent × (1 + recent yield) × how overdue (capped). Higher first. */
export function priority(type: string, yieldAvg: number | null, overdueHours: number, cadenceHours: number): number {
  const intent = INTENT[type] ?? 30;
  const overdue = Math.min(3, 1 + Math.max(0, overdueHours) / Math.max(1, cadenceHours));
  return intent * (1 + Math.min(2, (yieldAvg ?? 0) / PRODUCTIVE_YIELD)) * overdue;
}

/**
 * Start times for units that are due together (new ones, or overdue after downtime): highest
 * intent first, then one every `gapMinutes`. Returns ms timestamps in input order.
 */
export function staggerStarts(types: string[], now: number, gapMinutes: number): number[] {
  const order = types.map((t, i) => ({ t, i })).sort((a, b) => (INTENT[b.t] ?? 30) - (INTENT[a.t] ?? 30) || a.i - b.i);
  const out: number[] = new Array(types.length);
  order.forEach((o, k) => { out[o.i] = now + k * gapMinutes * 60_000; });
  return out;
}

/** Minimum gap between two LinkedIn-session reads on the same account (randomised per run). */
export function accountSpacingMinutes(rand = Math.random()): number {
  return 10 + Math.round(rand * 10);
}

export interface ActiveWindow { start: number; end: number; days: number[]; timezone: string }

function localParts(now: Date, tz: string): { hour: number; minute: number; weekday: number } {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(now);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")?.value ?? "Mon");
    return { hour: Number(p.find((x) => x.type === "hour")?.value ?? 0), minute: Number(p.find((x) => x.type === "minute")?.value ?? 0), weekday: wd === 0 ? 7 : wd };
  } catch { return { hour: now.getUTCHours(), minute: now.getUTCMinutes(), weekday: now.getUTCDay() || 7 }; }
}

export function inWindow(w: ActiveWindow, now = new Date()): boolean {
  const l = localParts(now, w.timezone);
  return w.days.includes(l.weekday) && l.hour >= w.start && l.hour < w.end;
}

/** The next moment the account's active window opens (now, if it is open). Scans in 15-minute steps. */
export function nextWindowStart(w: ActiveWindow, now = new Date()): Date {
  if (inWindow(w, now)) return now;
  const step = 15 * 60_000;
  let t = Math.ceil(now.getTime() / step) * step;
  for (let i = 0; i < 4 * 24 * 8; i++, t += step) if (inWindow(w, new Date(t))) return new Date(t);
  return new Date(now.getTime() + 24 * HOUR);
}

/**
 * Daily LinkedIn read budget, paced over the active window: by this point of the window the
 * account may have used its share plus a 20% burst. Outside the window nothing is allowed.
 */
export function pacedAllowance(w: ActiveWindow, dailyBudget: number, now = new Date()): number {
  if (!inWindow(w, now)) return 0;
  const l = localParts(now, w.timezone);
  const elapsed = (l.hour - w.start + l.minute / 60) / Math.max(1, w.end - w.start);
  return Math.min(dailyBudget, Math.ceil(dailyBudget * Math.min(1, elapsed + 0.2)));
}

/** Leads waiting for review above which discovery slows: finding more would only pile up. */
export const REVIEW_BACKLOG = 50;
