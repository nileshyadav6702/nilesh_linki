import type { ImportPerson } from "@/lib/agents/lead-imports";

/**
 * One-off LinkedIn reads for "Import from LinkedIn": a regular people search and the profile
 * visitors list. Each holds the account the way a runner unit does (withAccountSession), so a
 * busy account throws AccountBusyError (→ 409) instead of sharing the browser with the worker.
 */

/** Result pages read at most per search import (10 people per page). */
export const SEARCH_MAX_PAGES = 10;

export async function readPeopleSearchWithAccount(accountId: string, url: string, count: number): Promise<ImportPerson[]> {
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { scrapePeopleSearch } = await import("@/lib/agents/lookalike-search");
  return withAccountSession(accountId, async () => {
    const ctx = await getSessionContext(accountId);
    const out = new Map<string, ImportPerson>();
    try {
      for (let page = 1; page <= SEARCH_MAX_PAGES && out.size < count; page++) {
        const u = new URL(url);
        if (page > 1) u.searchParams.set("page", String(page)); else u.searchParams.delete("page");
        const people = await scrapePeopleSearch(ctx, accountId, u.toString());
        if (!people.length) break;
        for (const p of people) {
          if (!p.linkedinUrl || out.has(p.linkedinUrl)) continue;
          out.set(p.linkedinUrl, { name: p.fullName ?? "LinkedIn member", profileUrl: p.linkedinUrl, title: p.title, company: p.company, location: p.location, imageUrl: p.profileImageUrl });
        }
      }
    } finally { await saveSessionState(accountId).catch(() => {}); }
    return [...out.values()].slice(0, count);
  });
}

export async function readProfileVisitorsWithAccount(accountId: string): Promise<ImportPerson[]> {
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { consume } = await import("@/lib/linkedin/budget");
  const { VoyagerBudgetExceeded } = await import("@/lib/linkedin/voyager");
  const { extractPeople, scrollToEnd } = await import("@/lib/signals/sources/linkedin-audience");
  return withAccountSession(accountId, async () => {
    if (!consume(accountId, "voyager_read", 2)) throw new VoyagerBudgetExceeded("voyager_read");
    const page = await (await getSessionContext(accountId)).newPage();
    try {
      await page.goto("https://www.linkedin.com/analytics/profile-views/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(3000);
      await scrollToEnd(page);
      const people = await extractPeople(page);
      if (!people.length && /premium/i.test(await page.locator("main").innerText().catch(() => ""))) {
        throw new Error("LinkedIn only lists profile visitors on Premium accounts");
      }
      return people.map((p) => ({ name: p.name, profileUrl: p.profileUrl, headline: p.headline }));
    } finally {
      await page.close().catch(() => {});
      await saveSessionState(accountId).catch(() => {});
    }
  });
}
