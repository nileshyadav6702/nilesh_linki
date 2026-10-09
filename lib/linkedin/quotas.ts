/**
 * LinkedIn seat quotas and settings, as set in the seat's settings drawer. Quotas are weekly
 * (how LinkedIn itself counts invitations); each is spread over the seat's active days into the
 * daily cap the runner paces by, and the runner also stops at the weekly total
 * (lib/linkedin/actions.ts applyWeeklyQuota).
 */

/** Highest weekly quota accepted per action. LinkedIn restricts accounts well above these. */
export const WEEKLY_MAX = { weekly_visit_limit: 700, weekly_connection_limit: 200, weekly_message_limit: 700 } as const;
/** Hard daily ceilings (profile visits above ~150 a day read as scraping). */
export const DAILY_MAX = { daily_visit_limit: 150, daily_connection_limit: 100, daily_message_limit: 150 } as const;

/** Weekly quota → daily cap: spread evenly over the active days, never above the daily ceiling. */
export function weeklyToDaily(daily: keyof typeof DAILY_MAX, weekly: number, activeDays: number): number {
  return Math.min(DAILY_MAX[daily], Math.ceil(Math.max(0, weekly) / Math.max(1, Math.min(7, activeDays))));
}

type SeatColumn = keyof typeof WEEKLY_MAX | "country" | "inbox_contacts_only" | "ai_draft_replies" | "booking_url" | "reply_instructions";

/** Validates the seat fields present in a PUT body. Absent fields are left out (unchanged). */
export function parseSeatSettings(body: Record<string, unknown>): { values: Partial<Record<SeatColumn, string | number | null>> } | { error: string } {
  const values: Partial<Record<SeatColumn, string | number | null>> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  for (const k of Object.keys(WEEKLY_MAX) as Array<keyof typeof WEEKLY_MAX>) {
    if (!has(k)) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0) return { error: "Weekly limits must be zero or more" };
    values[k] = Math.min(WEEKLY_MAX[k], Math.round(n));
  }
  if (has("country")) {
    const c = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
    if (c && !/^[A-Z]{2}$/.test(c)) return { error: "Country must be a two-letter code" };
    values.country = c || null;
  }
  for (const k of ["inbox_contacts_only", "ai_draft_replies"] as const) if (has(k)) values[k] = body[k] ? 1 : 0;
  if (has("booking_url")) {
    const u = typeof body.booking_url === "string" ? body.booking_url.trim() : "";
    if (u && !/^https?:\/\/\S+\.\S+/i.test(u)) return { error: "The calendar link must be a full https:// URL" };
    values.booking_url = u.slice(0, 500) || null;
  }
  if (has("reply_instructions")) {
    const t = typeof body.reply_instructions === "string" ? body.reply_instructions.trim() : "";
    if (t.length > 500) return { error: "AI reply instructions can be at most 500 characters" };
    values.reply_instructions = t || null;
  }
  return { values };
}
