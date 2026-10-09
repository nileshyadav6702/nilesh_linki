import type Database from "better-sqlite3";

/** Personal account settings: name, writing language, timezone, daily email summary. */

export interface UserProfile { id: string; email: string; first_name: string | null; last_name: string | null; language: string | null; timezone: string | null; daily_digest: boolean }

export const LANGUAGES = ["English (US)", "English (UK)", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Swedish", "Danish",
  "Norwegian", "Finnish", "Polish", "Czech", "Romanian", "Greek", "Turkish", "Arabic", "Hebrew", "Hindi", "Indonesian", "Japanese", "Korean",
  "Chinese (Simplified)", "Chinese (Traditional)", "Vietnamese", "Thai", "Russian", "Ukrainian"] as const;

export function getUserProfile(db: Database.Database, userId: string): UserProfile | null {
  const row = db.prepare("SELECT id, email, first_name, last_name, language, timezone, daily_digest FROM users WHERE id = ?").get(userId) as
    (Omit<UserProfile, "daily_digest"> & { daily_digest: number }) | undefined;
  return row ? { ...row, daily_digest: !!row.daily_digest } : null;
}

export function displayName(p: Pick<UserProfile, "first_name" | "last_name"> | null): string | null {
  const n = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  return n || null;
}

/** The language AI messages this user generates are written in ("English (US)" → "English (US)"). */
export function userLanguage(db: Database.Database, userId: string | null | undefined): string | null {
  if (!userId) return null;
  return (db.prepare("SELECT language FROM users WHERE id = ?").get(userId) as { language: string | null } | undefined)?.language ?? null;
}

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
