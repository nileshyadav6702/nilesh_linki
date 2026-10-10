import { getDb } from "@/lib/db";

/**
 * Short-lived cache for public LinkedIn reads (a page's recent posts, a topic search, a post's
 * engagers), shared across agents: two agents tracking the same competitor within a few hours
 * pay for one read. Each agent still applies its own ICP filters to the result.
 */

export const READ_CACHE_HOURS = 6;

export async function cachedRead<T>(key: string, load: () => Promise<T>, ttlHours = READ_CACHE_HOURS): Promise<T> {
  const db = getDb();
  const row = db.prepare("SELECT json, fetched_at FROM signal_read_cache WHERE key = ?").get(key) as { json: string; fetched_at: string } | undefined;
  if (row && Date.now() - Date.parse(row.fetched_at) < ttlHours * 3_600_000) {
    try { return JSON.parse(row.json) as T; } catch { /* corrupt → reload */ }
  }
  const value = await load();
  db.prepare(`INSERT INTO signal_read_cache (key, json, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`).run(key, JSON.stringify(value), new Date().toISOString());
  // Keep the table small: drop entries a day old now and then.
  if (Math.random() < 0.05) db.prepare("DELETE FROM signal_read_cache WHERE fetched_at < ?").run(new Date(Date.now() - 86_400_000).toISOString());
  return value;
}
