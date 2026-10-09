import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { BRAND } from "@/lib/brand";

/**
 * Daily email summary of newly imported leads (Settings → Account → Email notifications).
 * Once a day, after 08:00 in the user's timezone, each opted-in user gets one email per
 * workspace that found new leads in the last 24 hours, sent from that workspace's mailbox.
 */

const SEND_HOUR = 8;
const CHECK_EVERY_MS = 15 * 60_000;

export interface DigestLead { full_name: string | null; title: string | null; company: string | null; score: number | null }
export interface Digest { workspace: string; newLeads: number; hot: number; replies: number; top: DigestLead[] }

/** Local date ("2026-10-09") and hour in a timezone; falls back to UTC for unknown zones. */
export function localClock(now: Date, timezone: string | null): { date: string; hour: number } {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch { return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours() }; }
}

export function buildDigest(db: Database.Database, workspaceId: string): Digest {
  const since = "datetime('now', '-1 day')";
  const ws = db.prepare("SELECT name FROM workspaces WHERE id = ?").get(workspaceId) as { name: string } | undefined;
  const score = "COALESCE(lead_score, intent_score)";
  const counts = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN ${score} >= 70 THEN 1 ELSE 0 END) hot FROM targets WHERE workspace_id = ? AND created_at >= ${since}`).get(workspaceId) as { n: number; hot: number | null };
  const replies = (db.prepare(`SELECT COUNT(*) n FROM targets WHERE workspace_id = ? AND COALESCE(last_replied_at, email_replied_at) >= ${since}`).get(workspaceId) as { n: number }).n;
  const top = db.prepare(`SELECT full_name, title, company, ${score} score FROM targets WHERE workspace_id = ? AND created_at >= ${since}
    ORDER BY ${score} IS NULL, ${score} DESC, created_at DESC LIMIT 5`).all(workspaceId) as DigestLead[];
  return { workspace: ws?.name ?? "Your workspace", newLeads: counts.n, hot: counts.hot ?? 0, replies, top };
}

export function digestText(d: Digest, appUrl: string): { subject: string; text: string } {
  const lines = d.top.map((l) => `• ${l.full_name ?? "Unknown"}${[l.title, l.company].filter(Boolean).length ? ` — ${[l.title, l.company].filter(Boolean).join(" @ ")}` : ""}${l.score !== null && l.score >= 70 ? "  🔥" : ""}`);
  const subject = `${d.newLeads} new lead${d.newLeads === 1 ? "" : "s"} in ${d.workspace}${d.hot ? ` · ${d.hot} hot` : ""}`;
  const text = [
    `Here's what your agents found in ${d.workspace} in the last 24 hours:`, "",
    `New leads: ${d.newLeads}`, `Hot leads (score 70+): ${d.hot}`, `Replies: ${d.replies}`, "",
    ...(lines.length ? ["Top new leads:", ...lines, ""] : []),
    `Review them: ${appUrl}/contacts`, "",
    `You get this because "Receive a daily email summary" is on in ${BRAND.name} → Settings → Account.`,
  ].join("\n");
  return { subject, text };
}

/** One pass: send every summary that is due now. Returns how many emails went out. */
export async function runDailyDigests(now = new Date()): Promise<number> {
  const db = getDb();
  const appUrl = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const users = db.prepare("SELECT id, email, timezone FROM users WHERE daily_digest = 1").all() as Array<{ id: string; email: string; timezone: string | null }>;
  let sent = 0;
  for (const u of users) {
    const clock = localClock(now, u.timezone);
    if (clock.hour < SEND_HOUR) continue;
    const key = `digest:${u.id}:${clock.date}`;
    if (db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(key)) continue;
    // Marked first, so a failing mailbox never turns into an email every 15 minutes.
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO NOTHING").run(key);
    const workspaces = db.prepare("SELECT workspace_id FROM workspace_members WHERE user_id = ?").all(u.id) as Array<{ workspace_id: string }>;
    for (const { workspace_id: ws } of workspaces) {
      const digest = buildDigest(db, ws);
      if (!digest.newLeads) continue;
      const account = db.prepare(`SELECT id, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure, username, password FROM email_accounts
        WHERE workspace_id = ? AND smtp_host IS NOT NULL AND password IS NOT NULL ORDER BY is_verified DESC, created_at LIMIT 1`).get(ws) as Record<string, unknown> | undefined;
      if (!account) continue;
      try {
        const [{ sendEmail }, { decryptSecret }] = await Promise.all([import("@/lib/email/sender"), import("@/lib/crypto")]);
        const { subject, text } = digestText(digest, appUrl);
        await sendEmail({ ...account, password: decryptSecret(String(account.password)) ?? "" } as Parameters<typeof sendEmail>[0], u.email, subject, text);
        sent++;
      } catch (err) { console.warn(`[digest] ${u.email} / ${ws}: ${err instanceof Error ? err.message : err}`); }
    }
  }
  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startDailyDigestSchedule(): void {
  if (timer || process.env.NODE_ENV === "test") return;
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runDailyDigests().catch((err) => console.warn("[digest] schedule:", err instanceof Error ? err.message : err)).finally(() => { busy = false; });
  }, CHECK_EVERY_MS);
  timer.unref?.();
}
