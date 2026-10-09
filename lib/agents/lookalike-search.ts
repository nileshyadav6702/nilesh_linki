import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import {
  lookalikeSearchUrl, parseFlagshipProfile, publicIdFromUrl, rankLookalikes, type LookalikeLead, type LookalikeProfile, type LookalikeScope,
} from "@/lib/agents/lookalike-rules";

/**
 * Live side of the Warm Lookalike source (wizard step 1): read the seed profile and run a first
 * Sales Navigator search, through the account's session exactly like the preview does. The
 * browser stack is loaded lazily so the API route stays light until it's used.
 */

export class LookalikeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "LookalikeError"; }
}

const PROFILE_NOT_FOUND = "An error occurred while searching for the profile. Please try again.";

/** The workspace's LinkedIn seat to read with: the asked one when valid, else the first connected. */
export function pickAccount(workspaceId: string, accountId?: string | null): string {
  const db = getDb();
  const row = accountId
    ? db.prepare("SELECT id FROM accounts WHERE id = ? AND workspace_id = ? AND is_authenticated = 1").get(accountId, workspaceId) as { id: string } | undefined
    : db.prepare("SELECT id FROM accounts WHERE workspace_id = ? AND is_authenticated = 1 ORDER BY created_at LIMIT 1").get(workspaceId) as { id: string } | undefined;
  if (!row) throw new LookalikeError("Connect a LinkedIn account with Sales Navigator in Settings to use Warm Lookalike.");
  return row.id;
}

/** Run `fn` on the account's browser session, translating LinkedIn and lock failures into user messages. */
async function onSession<T>(accountId: string, fn: (ctx: import("playwright").BrowserContext) => Promise<T>): Promise<T> {
  const { AccountBusyError, withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { VoyagerBlockedError, VoyagerBudgetExceeded } = await import("@/lib/linkedin/voyager");
  try {
    return await withAccountSession(accountId, async () => {
      try { return await fn(await getSessionContext(accountId)); } finally { await saveSessionState(accountId).catch(() => {}); }
    });
  } catch (err) {
    if (err instanceof LookalikeError) throw err;
    if (err instanceof AccountBusyError) throw new LookalikeError(err.message, 409);
    if (err instanceof VoyagerBudgetExceeded) throw new LookalikeError("This LinkedIn account has used today's lookup allowance. Try again tomorrow.", 429);
    if (err instanceof VoyagerBlockedError) {
      throw new LookalikeError(err.status === 401 || err.status === 403 ? "LinkedIn needs you to connect the account again." : "LinkedIn is limiting this account right now. Try again later.", 502);
    }
    console.error("[lookalike]", err instanceof Error ? err.message : err);
    throw new LookalikeError(PROFILE_NOT_FOUND, 502);
  }
}

/** Read the seed person from their LinkedIn profile page. */
export async function fetchLookalikeProfile(workspaceId: string, url: string, accountId?: string | null): Promise<LookalikeProfile> {
  const publicId = publicIdFromUrl(url);
  if (!publicId) throw new LookalikeError("Paste a LinkedIn profile URL, like https://www.linkedin.com/in/jane-doe");
  const account = pickAccount(workspaceId, accountId);
  const { VoyagerClient } = await import("@/lib/linkedin/voyager");
  const { linkedInImageUrl } = await import("@/lib/linkedin/images");
  const profile = await onSession(account, async (ctx) => {
    const client = new VoyagerClient(ctx, account);
    try {
      const bodies = await client.capturePage(`https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`, { match: /\/voyager\/api\//, scrolls: 1 });
      let found = parseFlagshipProfile(bodies, publicId, (img) => linkedInImageUrl(img));
      // Fallback when the page rendered server-side: ask the profile endpoint directly.
      if (!found) {
        const json = await client.get(`/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-18`, { normalized: true });
        if (json) found = parseFlagshipProfile([JSON.stringify(json)], publicId, (img) => linkedInImageUrl(img));
      }
      return found;
    } finally { await client.close(); }
  });
  if (!profile) throw new LookalikeError(PROFILE_NOT_FOUND, 404);
  return profile;
}

/** First page of the lookalike search, ranked by match. Retries without the industry filter when it finds no one. */
export async function searchLookalikes(workspaceId: string, scope: LookalikeScope, seedName: string | null, accountId?: string | null): Promise<{ leads: LookalikeLead[]; searchUrl: string }> {
  if (!scope.title.trim()) throw new LookalikeError("Add the role to look for.");
  const account = pickAccount(workspaceId, accountId);
  const { scrapeNavigatorUrl } = await import("@/lib/linkedin/scraper");
  return onSession(account, async (ctx) => {
    let failed: unknown = null;
    const run = async (u: string) => {
      try { return (await scrapeNavigatorUrl(ctx, u, { maxPages: 1 })).profiles; } catch (err) { failed = err; return []; }
    };
    let searchUrl = lookalikeSearchUrl(scope);
    let found = await run(searchUrl);
    if (!found.length && scope.industryId && !scope.relatedIndustries) {
      searchUrl = lookalikeSearchUrl(scope, { withIndustry: false });
      found = await run(searchUrl);
    }
    if (!found.length && failed) {
      console.error("[lookalike] search failed:", failed instanceof Error ? failed.message : failed);
      throw new LookalikeError("Sales Navigator didn't return results. Make sure this LinkedIn account has Sales Navigator, then try again.", 502);
    }
    if (!found.length) throw new LookalikeError("No similar people found on Sales Navigator. Try turning on similar roles or related industries, or widen the company sizes.", 404);
    return { leads: rankLookalikes(found, scope, seedName), searchUrl };
  });
}

/** AI suggestions for titles close to the seed's (for "Include similar roles"). */
export async function suggestSimilarTitles(workspaceId: string, title: string, company: string | null): Promise<string[]> {
  const out = await aiJson({
    workspaceId, purpose: "lookalike_query",
    instructions: [
      "Suggest up to 4 LinkedIn job titles held by people with the same role and seniority as the given title.",
      "Use common, real job title wording. Do not repeat the given title. Keep each under 6 words.",
    ],
    data: { title, company },
    outputShape: `{"titles":["..."]}`,
    schema: z.object({ titles: z.array(z.string().trim().min(2).max(80)).max(8) }),
    temperature: 0.3,
  });
  const seen = new Set([title.toLowerCase()]);
  return out.titles.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
}
