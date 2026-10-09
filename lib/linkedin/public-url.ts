import { getDb } from "@/lib/db";

/**
 * Public profile URLs. Signals (post engagers) and messaging give LinkedIn's internal member id
 * ("/in/ACoAAB…"), which often doesn't open as a link; older imports even lowercased it, which
 * breaks it for good. This job swaps those for the public URL ("/in/jane-doe"), a few per run
 * so it stays inside the account's daily LinkedIn read budget.
 */

const INTERNAL = /\/in\/(ACo[A-Za-z0-9_-]{20,})\/?$/;
/** A lowercased internal id: the original can't be recovered, so the person is looked up by name. */
const BROKEN = /\/in\/aco[a-z0-9_-]{30,}\/?$/;
const PER_RUN = 20;
/** Reads kept back for discovery and the inbox sync. */
const RESERVE = 50;

export const isInternalProfileUrl = (u: string | null | undefined) => !!u && (INTERNAL.test(u) || BROKEN.test(u));

interface Client { get(path: string, opts?: { accept?: string }): Promise<unknown | null> }

/** One LinkedIn read: internal id → "https://www.linkedin.com/in/<public handle>". */
export async function publicUrlFor(client: Client, internalId: string): Promise<string | null> {
  const j = await client.get(`/voyager/api/identity/dash/profiles/urn%3Ali%3Afsd_profile%3A${encodeURIComponent(internalId)}`);
  const id = j && typeof j === "object" ? (j as { publicIdentifier?: unknown }).publicIdentifier : null;
  return typeof id === "string" && id ? `https://www.linkedin.com/in/${id.toLowerCase()}` : null;
}

function tried(id: string) {
  getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(`public_url_tried:${id}`, "1");
}
const wasTried = (id: string) => !!getDb().prepare("SELECT 1 FROM app_settings WHERE key = ?").get(`public_url_tried:${id}`);

/** Repair up to PER_RUN profile links in the account's workspace. Returns how many were fixed. */
export async function repairProfileUrls(accountId: string): Promise<number> {
  const db = getDb();
  const acc = db.prepare("SELECT workspace_id FROM accounts WHERE id = ? AND is_authenticated = 1").get(accountId) as { workspace_id: string } | undefined;
  if (!acc) return 0;
  const ws = acc.workspace_id;
  const threads = db.prepare("SELECT id, participant_url u, target_id FROM inbox_threads WHERE workspace_id = ? AND account_id = ? AND participant_url LIKE '%/in/ACo%' LIMIT ?").all(ws, accountId, PER_RUN) as Array<{ id: string; u: string; target_id: string | null }>;
  const targets = (db.prepare(`SELECT id, linkedin_url u, full_name, company FROM targets WHERE workspace_id = ? AND (linkedin_url LIKE '%/in/ACo%' OR linkedin_url LIKE '%/in/aco%')
    ORDER BY created_at DESC LIMIT ?`).all(ws, PER_RUN * 3) as Array<{ id: string; u: string; full_name: string | null; company: string | null }>)
    .filter((t) => isInternalProfileUrl(t.u) && !wasTried(t.id)).slice(0, PER_RUN);
  if (!threads.length && !targets.length) return 0;
  // Leave most of the day's LinkedIn reads to lead discovery: repair only while plenty remain.
  const { remaining } = await import("@/lib/linkedin/budget");
  if (remaining(accountId, "voyager_read") < RESERVE) return 0;

  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { VoyagerClient, VoyagerBudgetExceeded } = await import("@/lib/linkedin/voyager");
  const setTarget = db.prepare("UPDATE targets SET linkedin_url = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM targets x WHERE x.workspace_id = ? AND lower(rtrim(x.linkedin_url, '/')) = ? AND x.id != ?)");
  let fixed = 0;
  await withAccountSession(accountId, async () => {
    const ctx = await getSessionContext(accountId);
    const client = new VoyagerClient(ctx, accountId);
    try {
      // One slow page or missing profile must not stop the rest of the batch; only the budget does.
      const soft = (err: unknown) => { if (err instanceof VoyagerBudgetExceeded) throw err; return null; };
      for (const t of threads) {
        const url = await publicUrlFor(client, t.u.match(INTERNAL)![1]).catch(soft);
        if (!url) continue;
        db.prepare("UPDATE inbox_threads SET participant_url = ? WHERE id = ?").run(url, t.id);
        if (t.target_id) setTarget.run(url, t.target_id, ws, url, t.target_id);
        fixed++;
      }
      for (const t of targets) {
        tried(t.id);
        let url: string | null = null;
        const internal = t.u.match(INTERNAL);
        if (internal) url = await publicUrlFor(client, internal[1]).catch(soft);
        else if (t.full_name) {
          // Lowercased id: find the person by name (and company) in LinkedIn search; exact name match only.
          const { scrapePeopleSearch } = await import("@/lib/agents/lookalike-search");
          const q = new URLSearchParams({ keywords: [t.full_name, t.company].filter(Boolean).join(" "), origin: "GLOBAL_SEARCH_HEADER" });
          const people = await scrapePeopleSearch(ctx, accountId, `https://www.linkedin.com/search/results/people/?${q}`).catch((err) => soft(err) ?? []);
          const hit = people.find((p) => p.fullName?.trim().toLowerCase() === t.full_name!.trim().toLowerCase() && p.linkedinUrl && !INTERNAL.test(p.linkedinUrl));
          url = hit?.linkedinUrl?.replace(/\/$/, "").toLowerCase() ?? null;
        }
        if (url && setTarget.run(url, t.id, ws, url, t.id).changes) fixed++;
      }
    } catch (err) {
      if (!(err instanceof VoyagerBudgetExceeded)) throw err;
    } finally {
      await client.close();
      await saveSessionState(accountId).catch(() => {});
    }
  });
  if (fixed) console.log(`[linkedin] replaced ${fixed} internal profile link(s) with public URLs`);
  return fixed;
}
