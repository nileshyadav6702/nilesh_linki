import { getDb } from "@/lib/db";
import { lastCampaignEmailAt } from "@/lib/linkedin/actions";
import { emailSendGapMs } from "@/lib/outreach/sequence";
import { slotInWindow, zonedParts, zonedTimeToUtcMs } from "@/lib/outreach/schedule";
import { MIN_EMAIL_GAP_MS, EMAIL_GAP_JITTER_MS } from "./constants";
import type { ScheduleConfig, EmailAccountLimits } from "./types";

// Working-window arithmetic and email pacing, all in the ACCOUNT's timezone.

export function effectiveEmailLimit(account: EmailAccountLimits): number {
  if (!account.ramp_up_enabled || !account.ramp_start_date) return account.daily_email_limit;
  const daysActive = Math.max(1, Math.floor((Date.now() - new Date(account.ramp_start_date).getTime()) / 86_400_000) + 1);
  const ramped = daysActive * 2;
  return Math.min(account.daily_email_limit, ramped);
}

/**
 * Decide whether this email account may send right now, or must wait.
 *
 * The daily cap is a ceiling, not a rate. On its own it lets an account emit its entire
 * allowance in a single burst (8 sends in 11 minutes observed in production) and then sit
 * idle for the rest of the window. Mailbox providers fingerprint burst rate and timing
 * regularity, not just daily volume, so that pattern is risky no matter how low the total.
 *
 * Spreads the remaining quota across the remaining working window, floored at
 * MIN_EMAIL_GAP_MS and jittered. Returns an ISO timestamp to wait until, or null to send.
 */
export function emailPaceGate(
  db: ReturnType<typeof getDb>,
  emailAccountId: string,
  limits: EmailAccountLimits,
  sentToday: number,
  dailyLimit: number,
): string | null {
  // Same ground-truth source (sent_messages) AND the same day bounds as the daily-limit
  // guard, so the two can never disagree about what "today" means for this account.
  const last = lastCampaignEmailAt(db, emailAccountId, limits.timezone);
  if (!last) return null; // first send of the day for this account

  // sent_messages.accepted_at is SQLite datetime('now') — UTC, no zone suffix.
  const lastMs = Date.parse(`${last.replace(" ", "T")}Z`);
  if (Number.isNaN(lastMs)) return null;

  const { hour, minute } = getLocalParts(limits.timezone);
  const remainingHours = Math.max(0, limits.active_hours_end - (hour + minute / 60));
  const remainingSends = Math.max(1, dailyLimit - sentToday);

  const jitter = (Math.random() * 2 - 1) * EMAIL_GAP_JITTER_MS;
  const readyAt = lastMs + emailSendGapMs(remainingHours, remainingSends, MIN_EMAIL_GAP_MS, jitter);
  return readyAt > Date.now() ? new Date(readyAt).toISOString() : null;
}

export function getLocalParts(tz: string, date = new Date()): { hour: number; minute: number; isoWeekday: number } {
  const safeZone = (() => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; } })();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hour, minute, isoWeekday: weekdayMap[get("weekday")] ?? 1 };
}

export function isWithinSchedule(account: ScheduleConfig): boolean {
  const { hour, minute, isoWeekday } = getLocalParts(account.timezone || "UTC");
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  if (!allowedDays.includes(isoWeekday)) return false;
  const frac = hour + minute / 60;
  return frac >= (account.active_hours_start ?? 9) && frac < (account.active_hours_end ?? 18);
}

// Slots are generated in the ACCOUNT's timezone so they agree with isWithinSchedule,
// which also evaluates there. Generating them in server-local time meant a UTC host with
// an America/New_York account produced 09:00-18:00 UTC = 05:00-14:00 NY, so many slots
// were already outside the window on arrival and were rescheduled again immediately.
export function randomSlotInActiveWindow(account: ScheduleConfig, targetDate?: Date): string {
  const tz = account.timezone || "UTC";
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;
  const base = targetDate ?? new Date();
  const slot = slotInWindow(tz, base, start, end);
  if (slot) return slot;
  // Misconfigured window (start >= end): fall back to the window start on that day.
  const { year, month, day } = zonedParts(tz, base);
  return new Date(zonedTimeToUtcMs(tz, year, month, day, start)).toISOString();
}

export function rescheduleToTomorrow(account: ScheduleConfig): string {
  const tz = account.timezone || "UTC";
  // Advance a day on the ACCOUNT's calendar, not the server's. Anchoring at local noon
  // keeps the +24h hop on the intended day across DST transitions.
  const { year, month, day } = zonedParts(tz);
  const allowed = (account.working_days || "1,2,3,4,5").split(",").map(Number).map((d) => (d === 0 ? 7 : d));
  // The next WORKING day (a Friday-evening reschedule lands on Monday, not Saturday).
  for (let k = 1; k <= 8; k++) {
    const candidate = new Date(zonedTimeToUtcMs(tz, year, month, day, 12) + k * 86_400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(candidate);
    const iso = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
    if (allowed.includes(iso)) return randomSlotInActiveWindow(account, candidate);
  }
  return randomSlotInActiveWindow(account, new Date(zonedTimeToUtcMs(tz, year, month, day, 12) + 86_400_000));
}

export function nextScheduledSlot(account: ScheduleConfig): string {
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;
  const now = new Date();

  // Today, when it is a working day and the window has not closed yet. slotInWindow
  // clamps the lower bound to max(window start, now), which is the fix for the
  // reschedule loop: previously only the END was checked, so a track woken BEFORE the
  // window (e.g. 03:00 for a 09:00-18:00 account) got a slot anywhere in the next 15
  // hours - frequently seconds away and still outside the window - which tripped the
  // same guard on the next poll, over and over. The +60s floor also stops a slot
  // landing effectively "now".
  if (allowedDays.includes(zonedParts(tz, now).isoWeekday)) {
    const slot = slotInWindow(tz, now, start, end, now.getTime() + 60_000);
    if (slot) return slot;
  }
  for (let i = 1; i <= 14; i++) {
    const candidate = new Date(now.getTime() + i * 86_400_000);
    if (!allowedDays.includes(zonedParts(tz, candidate).isoWeekday)) continue;
    const slot = slotInWindow(tz, candidate, start, end);
    if (slot) return slot;
  }
  return new Date(Date.now() + 86_400_000).toISOString();
}
