import { z } from "zod";
import { aiJson } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import {
  companyFacts, currentRoleFromExperience, lookalikeSearchUrl, parseFlagshipProfile, publicIdFromUrl, rankLookalikes,
  type LookalikeLead, type LookalikeProfile, type LookalikeScope,
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
      // LinkedIn renders the profile's Experience server-side, so the page text is the reliable source for the current role.
      const page = await readPage(ctx, account, `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`, PROFILE_DOM);
      let found = parseFlagshipProfile(page.bodies, publicId, (img) => linkedInImageUrl(img));
      if (!found) {
        const json = await client.get(`/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-18`, { normalized: true }).catch(() => null);
        if (json) found = parseFlagshipProfile([JSON.stringify(json)], publicId, (img) => linkedInImageUrl(img));
      }
      const dom = page.dom as ProfileDom | null;
      const name = found?.name ?? dom?.name ?? null;
      if (!name) return null;
      const role = currentRoleFromExperience(dom?.experience ?? []);
      const out: LookalikeProfile = found ?? {
        name, headline: dom?.headline ?? null, title: null, company: null, location: null, geoId: null, industry: null, industryId: null,
        photo: null, linkedinUrl: `https://www.linkedin.com/in/${publicId}/`,
      };
      out.location = out.location ?? dom?.location ?? null;
      out.photo = out.photo ?? dom?.photo ?? null;
      out.headline = out.headline ?? dom?.headline ?? null;
      if (role?.title) out.title = role.title;
      if (role?.company) out.company = role.company;
      out.companyUrl = role?.companyUrl ?? null;
      // The person's page no longer shows an industry; their employer's page does, with its headcount.
      if (out.companyUrl) {
        const company = await readPage(ctx, account, out.companyUrl, COMPANY_DOM).catch(() => null);
        const facts = companyFacts((company?.dom as string[] | null) ?? []);
        out.industry = out.industry ?? facts.industry;
        out.companySize = facts.size;
      }
      return out;
    } finally { await client.close(); }
  });
  if (!profile) throw new LookalikeError(PROFILE_NOT_FOUND, 404);
  return profile;
}

interface ProfileDom { name: string | null; headline: string | null; location: string | null; photo: string | null; experience: Array<{ href: string; text: string }> }

/** Runs in the page: name, headline, and every company link's text (Experience entries among them). */
const PROFILE_DOM = (): ProfileDom => {
  const name = document.querySelector("main h1")?.textContent?.trim() || document.title.replace(/^\(\d+\)\s*/, "").split("|")[0].trim() || null;
  const lines = ((document.querySelector("main") as HTMLElement | null)?.innerText ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const at = name ? lines.indexOf(name) : -1;
  const headline = at >= 0 ? lines.slice(at + 1, at + 5).find((l) => !/^(·|He\/Him|She\/Her|They\/Them|· \d(st|nd|rd))/.test(l) && l.length > 2) ?? null : null;
  // Top card: "Name / pronouns / · 2nd / Headline / Location / · / Contact info".
  const contact = lines.indexOf("Contact info");
  const location = contact > 0 ? lines.slice(Math.max(at + 1, contact - 3), contact).reverse().find((l) => l !== "·" && l !== headline && l.length > 2) ?? null : null;
  const img = Array.from(document.querySelectorAll("main img")).find((i) => /profile-displayphoto/.test((i as HTMLImageElement).src)) as HTMLImageElement | undefined;
  const experience = Array.from(document.querySelectorAll("main a[href*='/company/']"))
    .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a as HTMLElement).innerText ?? "" }))
    .filter((x) => x.text.trim());
  return { name, headline, location, photo: img?.src ?? null, experience };
};

/** Runs in the page: the company top card's separate items (industry, location, followers, employees). */
const COMPANY_DOM = (): string[] => {
  const els = Array.from(document.querySelectorAll("main *")) as HTMLElement[];
  const box = els
    .filter((e) => /followers/i.test(e.innerText ?? "") && /employees/i.test(e.innerText ?? "") && (e.innerText ?? "").length < 400)
    .sort((a, b) => (a.innerText ?? "").length - (b.innerText ?? "").length)[0];
  // The smallest match is the "city · followers · employees" group; the industry sits one level up.
  const list = document.querySelector("main .org-top-card-summary-info-list") ?? box?.parentElement ?? box;
  if (!list) return [];
  // Text nodes, not leaf elements: the industry sits as bare text beside the linked city and counts.
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
  const items: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t && t !== "·" && t !== "•") items.push(t);
  }
  return items.length > 1 ? items : ((list as HTMLElement).innerText ?? "").split("\n");
};

/**
 * Open a LinkedIn page the way a person would (charged to the account's daily read budget),
 * keep the voyager responses it loads and run `extract` on the rendered page.
 */
async function readPage<T>(ctx: import("playwright").BrowserContext, accountId: string, url: string, extract: () => T): Promise<{ bodies: string[]; dom: T | null }> {
  const { consume } = await import("@/lib/linkedin/budget");
  const { VoyagerBlockedError, VoyagerBudgetExceeded } = await import("@/lib/linkedin/voyager");
  if (!consume(accountId, "voyager_read")) throw new VoyagerBudgetExceeded("voyager_read");
  const page = await ctx.newPage();
  const bodies: string[] = [];
  const pending: Array<Promise<void>> = [];
  page.on("response", (resp) => {
    if (!/\/voyager\/api\//.test(resp.url()) || resp.status() !== 200) return;
    pending.push(resp.text().then((t) => { bodies.push(t); }, () => {}));
  });
  try {
    const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (/\/(login|checkpoint|authwall)/.test(page.url())) throw new VoyagerBlockedError(401);
    if (nav && [429, 999].includes(nav.status())) throw new VoyagerBlockedError(nav.status());
    await page.waitForTimeout(4500 + Math.random() * 2000);
    await page.mouse.wheel(0, 1800 + Math.random() * 600);
    await page.waitForTimeout(2000 + Math.random() * 1200);
    await Promise.all(pending);
    const dom = await page.evaluate(extract).catch(() => null);
    return { bodies, dom };
  } finally {
    await page.close().catch(() => {});
  }
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
