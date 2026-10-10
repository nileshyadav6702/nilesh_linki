import type { Page } from "playwright";
import { consume } from "@/lib/linkedin/budget";
import type { SourceRunContext, SourceRunner } from "@/lib/signals/sources/types";

/**
 * People already paying attention, read from the agent's LinkedIn session:
 *  - profile_visitors: "Who viewed your profile" (LinkedIn shows the full list on Premium)
 *  - company_followers: the followers list of a company page the account administers
 */

export interface AudiencePerson { name: string; profileUrl: string; headline: string | null }

/** People linked from the page's main content: name and the line under it, once each. */
export async function extractPeople(page: Page, scope = "main, [role='dialog']"): Promise<AudiencePerson[]> {
  return page.evaluate((sel) => {
    const out: Array<{ name: string; profileUrl: string; headline: string | null }> = [];
    const seen = new Set<string>();
    const roots = Array.from(document.querySelectorAll(sel));
    for (const root of roots.length ? roots : [document.body]) {
      for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
        const m = (a.getAttribute("href") ?? "").match(/\/in\/([^/?#]+)/);
        if (!m || m[1] === "me") continue;
        const handle = decodeURIComponent(m[1]);
        if (seen.has(handle.toLowerCase())) continue;
        const card = a.closest("li, [data-view-name], .artdeco-list__item, article") ?? a;
        const lines = ((card as HTMLElement).innerText ?? "").split("\n").map((s) => s.trim()).filter((s) => s && !/^(view|connect|follow|message|·|•|\d+(st|nd|rd|th)( degree)?( connection)?)$/i.test(s));
        const name = (a.innerText ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? lines[0];
        if (!name || /linkedin member|someone at/i.test(name)) continue;
        seen.add(handle.toLowerCase());
        const headline = lines.find((l) => l !== name && !l.startsWith(name) && l.length > 3) ?? null;
        out.push({ name, profileUrl: `https://www.linkedin.com/in/${handle}`, headline });
      }
    }
    return out;
  }, scope);
}

export async function scrollToEnd(page: Page, rounds = 12) {
  let last = 0;
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => {
      const box = document.querySelector("[role='dialog'] .artdeco-modal__content, #workspace, main");
      if (box) box.scrollTop = box.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1200);
    const n = await page.locator("a[href*='/in/']").count();
    if (n === last) break;
    last = n;
  }
}

function requireSession(ctx: SourceRunContext, what: string) {
  if (!ctx.browser || !ctx.agent.linkedin_account_id) throw new Error(`${what} needs a connected LinkedIn account on the agent`);
  if (!consume(ctx.agent.linkedin_account_id, "voyager_read", 2)) throw new Error("Daily LinkedIn discovery budget reached (voyager_read)");
}

export const profileVisitorsRunner: SourceRunner = async (ctx) => {
  requireSession(ctx, "Profile visitors");
  const page = await ctx.browser!.newPage();
  try {
    await page.goto("https://www.linkedin.com/analytics/profile-views/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    await scrollToEnd(page);
    const people = await extractPeople(page);
    if (!people.length && /premium/i.test(await page.locator("main").innerText().catch(() => ""))) {
      throw new Error("LinkedIn only lists profile visitors on Premium accounts");
    }
    const month = new Date().toISOString().slice(0, 7);
    for (const p of people) {
      if (ctx.isFull()) break;
      ctx.emitLead({ name: p.name, profileUrl: p.profileUrl, headline: p.headline }, {
        type: "profile_view", title: "Viewed your LinkedIn profile", sourceUrl: p.profileUrl,
        dedupeKey: `profile_view:${ctx.agent.linkedin_account_id}:${p.profileUrl.toLowerCase()}:${month}`,
      });
    }
  } finally { await page.close().catch(() => {}); }
};

export const companyFollowersRunner: SourceRunner = async (ctx) => {
  const companyUrl = ctx.config.urls[0];
  if (!companyUrl) throw new Error("Add your company page to track its followers");
  requireSession(ctx, "Company page followers");
  const page = await ctx.browser!.newPage();
  try {
    await page.goto(`${companyUrl.replace(/\/$/, "")}/admin/analytics/followers/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    if (!/\/admin\//.test(page.url())) throw new Error("Only admins of the company page can see its followers: this LinkedIn account isn't one");
    const all = page.getByRole("button", { name: /show all followers|all followers/i }).first();
    if (await all.isVisible().catch(() => false)) { await all.click(); await page.waitForTimeout(2000); }
    await scrollToEnd(page);
    for (const p of await extractPeople(page)) {
      if (ctx.isFull()) break;
      ctx.emitLead({ name: p.name, profileUrl: p.profileUrl, headline: p.headline }, {
        type: "company_follow", title: "Follows your company page", sourceUrl: companyUrl,
        dedupeKey: `company_follow:${companyUrl.toLowerCase()}:${p.profileUrl.toLowerCase()}`,
      });
    }
  } finally { await page.close().catch(() => {}); }
};
