import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { detectTechnologies, domainOf } from "@/lib/signals/sources/tech-stack";
import { searchTechnologies } from "@/lib/signals/tech-catalog";
import { DECISION_MAKER_RE, postsWithin, startedWithin } from "@/lib/signals/sources/icp-people";
import { isSurge, surgeBaseline } from "@/lib/signals/sources/hiring";
import { extractPeople } from "@/lib/signals/sources/linkedin-audience";
import { countSignals } from "@/lib/agents/lead-source-rules";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

describe("tech stack detection", () => {
  it("finds tools from script hosts and response headers", () => {
    const html = `<html><script src="https://widget.intercom.io/widget/abc"></script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>
      <link href="/wp-content/themes/x.css"></html>`;
    expect(detectTechnologies(html, { "x-vercel-id": "fra1::abc" }).sort()).toEqual(["Google Tag Manager", "Intercom", "Vercel", "WordPress"]);
    expect(detectTechnologies("<html>plain</html>")).toEqual([]);
  });
  it("normalises websites to domains and searches the catalog", () => {
    expect(domainOf("https://www.Acme.io/pricing")).toBe("acme.io");
    expect(domainOf("acme.io")).toBe("acme.io");
    expect(domainOf(null)).toBeNull();
    expect(searchTechnologies("goo").map((t) => t.name)).toEqual(expect.arrayContaining(["Google Analytics", "Google Tag Manager"]));
    expect(searchTechnologies("live chat").map((t) => t.name)).toContain("Intercom");
  });
});

describe("ICP people signals", () => {
  it("counts posts in the last 30 days", () => {
    expect(postsWithin([{ postedAt: ago(1) }, { postedAt: ago(10) }, { postedAt: ago(45) }, { postedAt: null }], 30, NOW)).toBe(2);
  });
  it("recognises a role started in the last 90 days (month precision too)", () => {
    expect(startedWithin("2026-08-01", 90, NOW)).toBe(true);
    expect(startedWithin("2026-09", 90, NOW)).toBe(true);
    expect(startedWithin("2025-01-01", 90, NOW)).toBe(false);
    expect(startedWithin(null, 90, NOW)).toBe(false);
  });
  it("only treats senior titles as decision-makers", () => {
    expect(DECISION_MAKER_RE.test("VP of Sales")).toBe(true);
    expect(DECISION_MAKER_RE.test("Head of Growth @ Levellr")).toBe(true);
    expect(DECISION_MAKER_RE.test("Sales Development Representative")).toBe(false);
  });
});

describe("hiring surge", () => {
  it("compares against a count from 2-6 weeks ago", () => {
    const history = [{ at: ago(50), n: 2 }, { at: ago(30), n: 8 }, { at: ago(20), n: 10 }, { at: ago(3), n: 14 }];
    expect(surgeBaseline(history, NOW)).toBe(10);
    expect(surgeBaseline([{ at: ago(3), n: 10 }], NOW)).toBeNull(); // still building history
    expect(isSurge(16, 10)).toBe(true);
    expect(isSurge(14, 10)).toBe(false); // +40%
    expect(isSurge(6, 3)).toBe(false); // doubled but only +3 roles
    expect(isSurge(20, null)).toBe(false);
  });
});

describe("signal budget", () => {
  it("counts technologies one each and every switched-on event once", () => {
    expect(countSignals({
      tech_stack: { enabled: true, config: { keywords: ["Intercom", "Drift"] } },
      top_active: { enabled: true, config: {} }, hiring_surge: { enabled: true, config: {} },
      profile_visitors: { enabled: false, config: {} }, company_followers: { enabled: true, config: { urls: ["https://www.linkedin.com/company/acme"] } },
    })).toBe(5);
  });
});

describe("LinkedIn audience lists", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
  afterAll(async () => { await browser?.close(); });
  it("reads each visible person once, skipping anonymous viewers and the account itself", async () => {
    const page = await browser.newPage();
    await page.setContent(`<nav><a href="/in/me/">Me</a></nav><main><ul>
      <li><a href="https://www.linkedin.com/in/jane-doe/"><span>Jane Doe</span></a><div>2nd</div><div>VP Sales at Acme</div><button>Connect</button></li>
      <li><a href="/in/jane-doe/">View</a></li>
      <li><a href="/in/ACoAAB123/"><span>LinkedIn Member</span></a><div>Someone at a SaaS company</div></li>
      <li><a href="/in/bob-roe?miniProfile=1"><span>Bob Roe</span></a><div>Founder, Roe Labs</div></li></ul></main>`);
    expect(await extractPeople(page)).toEqual([
      { name: "Jane Doe", profileUrl: "https://www.linkedin.com/in/jane-doe", headline: "VP Sales at Acme" },
      { name: "Bob Roe", profileUrl: "https://www.linkedin.com/in/bob-roe", headline: "Founder, Roe Labs" },
    ]);
    await page.close();
  }, 60_000);
});
