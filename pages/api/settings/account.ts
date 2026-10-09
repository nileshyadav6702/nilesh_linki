import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getUserProfile, isValidTimezone, LANGUAGES } from "@/lib/user-profile";
import { requireWorkspace } from "@/lib/workspace";

// GET   /api/settings/account → your profile (name, language, timezone, daily summary) + the language list
// PATCH /api/settings/account { first_name?, last_name?, language?, timezone?, daily_digest? }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, "viewer");
  if (!ctx) return;
  if (!ctx.userId) return res.status(403).json({ error: "Only signed-in users have account settings" });
  const db = getDb();
  if (req.method === "GET") return res.json({ profile: getUserProfile(db, ctx.userId), languages: LANGUAGES });
  if (req.method === "PATCH") {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of ["first_name", "last_name"] as const) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "string" || (b[k] as string).length > 80) return res.status(400).json({ error: `${k.replace("_", " ")} must be text (80 characters max)` });
      sets.push(`${k} = ?`); vals.push((b[k] as string).trim() || null);
    }
    if (b.language !== undefined) {
      if (b.language !== null && !(LANGUAGES as readonly string[]).includes(String(b.language))) return res.status(400).json({ error: "Unknown language" });
      sets.push("language = ?"); vals.push(b.language);
    }
    if (b.timezone !== undefined) {
      if (b.timezone !== null && (typeof b.timezone !== "string" || !isValidTimezone(b.timezone))) return res.status(400).json({ error: "Unknown timezone" });
      sets.push("timezone = ?"); vals.push(b.timezone);
    }
    if (b.daily_digest !== undefined) {
      if (typeof b.daily_digest !== "boolean") return res.status(400).json({ error: "daily_digest must be true or false" });
      sets.push("daily_digest = ?"); vals.push(b.daily_digest ? 1 : 0);
    }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, ctx.userId);
    return res.json({ profile: getUserProfile(db, ctx.userId) });
  }
  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
