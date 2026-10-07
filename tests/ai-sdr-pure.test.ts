import { describe, it, expect } from "vitest";
import { intentScore, leadScore } from "@/lib/signals/scoring";
import { parseComments, parseReactions, parseFeedUpdates, parseEntityUrl, dedupeEngagers, activityIdOf, activityUrnsIn, searchPostsByKeyword, fetchPostEngagers, type Engager } from "@/lib/linkedin/engagers";
import { prefilterLead, splitHeadline, normalizeProfileUrl } from "@/lib/signals/leads";
import { htmlToText, extractInterestingLinks, isPrivateAddress, normalizeWebsiteUrl, UnsafeUrlError } from "@/lib/icp/site";
import { parseBoard, matchesRoles, isoWeek } from "@/lib/signals/sources/hiring";
import { parseFeed } from "@/lib/signals/sources/funding";
import { sameCompany } from "@/lib/signals/sources/job-change";
import { emailPatterns, domainFrom } from "@/lib/enrichment/waterfall";
import { ruleFit } from "@/lib/agents/fit";
import { withinActiveHours } from "@/lib/signals/linkedin-discovery";
import { icpSchema } from "@/lib/icp/schema";
import { salesNavSearchUrl } from "@/lib/signals/sources/lookalike";

const DAY = 86_400_000;
const icp = icpSchema.parse({
  company_name: "Linki",
  personas: [{ name: "Sales leader", titles: ["VP Sales", "Head of Sales"], seniority: [], departments: ["Sales"], pains: [] }],
  competitors: [{ name: "Gojiberry", linkedin_url: "https://www.linkedin.com/company/gojiberry" }],
  exclusions: ["consultant"],
});

describe("intent scoring", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("halves a signal's weight every half-life", () => {
    expect(intentScore([{ weight: 40, occurred_at: new Date(now).toISOString() }], now)).toBe(40);
    expect(intentScore([{ weight: 40, occurred_at: new Date(now - 14 * DAY).toISOString() }], now)).toBe(20);
  });
  it("sums signals and caps at 100", () => {
    const fresh = new Date(now).toISOString();
    expect(intentScore([{ weight: 60, occurred_at: fresh }, { weight: 70, occurred_at: fresh }], now)).toBe(100);
  });
  it("accepts SQLite datetime strings", () => {
    expect(intentScore([{ weight: 30, occurred_at: "2026-10-07 12:00:00" }], now)).toBe(30);
  });
  it("blends fit and intent with a neutral default for unscored fit", () => {
    expect(leadScore(80, 50, 0.6)).toBe(68);
    expect(leadScore(null, 0, 0.6)).toBe(30);
  });
});

describe("engager parsers", () => {
  it("reads legacy nested comments with the commenter's mini profile", () => {
    const json = { elements: [{
      commenter: { "com.linkedin.voyager.feed.MemberActor": { miniProfile: { firstName: "Ada", lastName: "Lovelace", occupation: "VP Sales at Acme", publicIdentifier: "ada-l", objectUrn: "urn:li:member:123" } } },
      commentV2: { text: "We struggle with this too" },
    }] };
    const [e] = parseComments(json);
    expect(e).toMatchObject({ name: "Ada Lovelace", headline: "VP Sales at Acme", profileUrl: "https://www.linkedin.com/in/ada-l", memberUrn: "urn:li:member:123", kind: "comment", commentText: "We struggle with this too" });
  });

  it("resolves normalized comment references through `included`", () => {
    const json = { data: { "*elements": ["urn:li:comment:1"] }, included: [
      { entityUrn: "urn:li:comment:1", commentV2: { text: "Great point" }, commenter: { "com.linkedin.voyager.feed.MemberActor": { "*miniProfile": "urn:li:fs_miniProfile:AB" } } },
      { entityUrn: "urn:li:fs_miniProfile:AB", firstName: "Grace", lastName: "Hopper", occupation: "Head of Sales", publicIdentifier: "grace" },
    ] };
    expect(parseComments(json)[0]).toMatchObject({ name: "Grace Hopper", commentText: "Great point" });
  });

  it("reads dash reactions and drops company pages", () => {
    const json = { elements: [
      { reactionType: "LIKE", actorUrn: "urn:li:fsd_profile:XYZ", reactorLockup: { title: { text: "Alan Turing" }, subtitle: { text: "CTO at Bletchley" }, navigationUrl: "https://www.linkedin.com/in/alan?mini=true" } },
      { reactionType: "LIKE", actorUrn: "urn:li:fsd_company:9", reactorLockup: { title: { text: "Acme Inc" }, navigationUrl: "https://www.linkedin.com/company/acme" } },
    ] };
    const r = parseReactions(json);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Alan Turing", firstName: "Alan", lastName: "Turing", profileUrl: "https://www.linkedin.com/in/alan", reactionType: "LIKE" });
  });

  it("keeps one entry per person, preferring the comment", () => {
    const base: Engager = { name: "A B", firstName: "A", lastName: "B", headline: null, profileUrl: null, memberUrn: "urn:li:fsd_profile:1", kind: "reaction", reactionType: "LIKE", commentText: null };
    const out = dedupeEngagers([base, { ...base, kind: "comment", commentText: "hi", memberUrn: "urn:li:member:1" }]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("comment");
  });

  it("extracts posts from feed updates, newest first", () => {
    const json = { included: [
      { $type: "com.linkedin.voyager.feed.render.UpdateV2", updateMetadata: { urn: "urn:li:activity:7100000000000000000" }, commentary: { text: { text: "Older post" } } },
      { $type: "com.linkedin.voyager.feed.render.UpdateV2", updateMetadata: { urn: "urn:li:activity:7300000000000000000" }, commentary: { text: { text: "Newer post" } } },
    ] };
    const posts = parseFeedUpdates(json);
    expect(posts.map((p) => p.text)).toEqual(["Newer post", "Older post"]);
    expect(posts[0].postedAt).toMatch(/^20\d\d-/);
  });

  it("parses entity URLs and activity ids", () => {
    expect(parseEntityUrl("https://www.linkedin.com/company/gojiberry-ai/posts/")).toEqual({ kind: "company", universalName: "gojiberry-ai" });
    expect(parseEntityUrl("https://linkedin.com/in/jane-doe?x=1")).toEqual({ kind: "profile", publicId: "jane-doe" });
    expect(parseEntityUrl("https://example.com")).toBeNull();
    expect(activityIdOf("urn:li:activity:7300000000000000000")).toBe("7300000000000000000");
  });
});

describe("keyword search (server-rendered results)", () => {
  it("reads post URNs from the search page stream, not the empty JSON wrappers", async () => {
    const calls: string[] = [];
    const client = {
      get: async (p: string) => { calls.push(p); return null; },
      capturePage: async (url: string) => {
        calls.push(url);
        return ["<html>…urn:li:activity:7300000000000000001…urn:li:activity:7300000000000000001…</html>", "0:[\"urn:li:activity:7300000000000000002\"]"];
      },
    };
    const posts = await searchPostsByKeyword(client, "front end (react)", 5);
    expect(posts.map((p) => p.activityUrn)).toEqual(["urn:li:activity:7300000000000000001", "urn:li:activity:7300000000000000002"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/search/results/content/?keywords=front%20end%20%20react");
  });
  it("dedupes URNs across bodies", () => {
    expect(activityUrnsIn(["urn:li:activity:7300000000000000009 x", "urn:li:activity:7300000000000000009"])).toEqual(["urn:li:activity:7300000000000000009"]);
  });
  it("fetches engagers from reactions only (the comments endpoint is retired)", async () => {
    const paths: string[] = [];
    await fetchPostEngagers({ get: async (p: string) => { paths.push(p); return { elements: [] }; } }, "urn:li:activity:7300000000000000001");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("voyagerSocialDashReactions");
  });
});

describe("lead prefilter", () => {
  it("splits headlines into title and company", () => {
    expect(splitHeadline("VP Sales at Acme | ex-Google")).toEqual({ title: "VP Sales", company: "Acme" });
    expect(splitHeadline("Founder @ Rocket")).toEqual({ title: "Founder", company: "Rocket" });
    expect(splitHeadline("Builder of things")).toEqual({ title: "Builder of things", company: null });
  });
  it("drops competitors' employees, our own staff and excluded titles", () => {
    expect(prefilterLead({ name: "x", headline: "AE at Gojiberry" }, { icp }).ok).toBe(false);
    expect(prefilterLead({ name: "x", headline: "Growth at Linki" }, { icp }).ok).toBe(false);
    expect(prefilterLead({ name: "x", headline: "Independent consultant" }, { icp }).ok).toBe(false);
    expect(prefilterLead({ name: "x", headline: "Technical Recruiter at Foo" }, { icp }).ok).toBe(false);
    expect(prefilterLead({ name: "x", headline: "VP Sales at Acme" }, { icp }).ok).toBe(true);
  });
  it("normalizes profile URLs", () => {
    expect(normalizeProfileUrl("https://www.linkedin.com/in/Jane-Doe/?utm=1")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(normalizeProfileUrl("https://www.linkedin.com/company/x")).toBeNull();
  });
});

describe("website fetch helpers", () => {
  it("turns HTML into readable text without scripts", () => {
    const text = htmlToText("<html><head><title>Acme</title><script>evil()</script></head><body><h1>We help sales teams</h1><p>Book &amp; close</p></body></html>");
    expect(text).toContain("Acme");
    expect(text).toContain("We help sales teams");
    expect(text).toContain("Book & close");
    expect(text).not.toContain("evil");
  });
  it("keeps only informative same-origin links", () => {
    const base = new URL("https://acme.com/");
    const links = extractInterestingLinks(`<a href="/pricing">p</a><a href="https://other.com/about">x</a><a href="/blog/post">b</a><a href="/about-us#team">a</a>`, base);
    expect(links.map((l) => l.pathname)).toEqual(["/pricing", "/about-us"]);
  });
  it("blocks private and non-http targets", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(() => normalizeWebsiteUrl("ftp://acme.com")).toThrow(UnsafeUrlError);
    expect(() => normalizeWebsiteUrl("https://user:pw@acme.com")).toThrow(UnsafeUrlError);
    expect(normalizeWebsiteUrl("acme.com").href).toBe("https://acme.com/");
  });
});

describe("hiring, funding and job-change sources", () => {
  it("parses each job board format", () => {
    expect(parseBoard("greenhouse", { jobs: [{ title: "SDR", absolute_url: "https://x/1", location: { name: "Remote" } }] })[0]).toMatchObject({ title: "SDR", location: "Remote" });
    expect(parseBoard("lever", [{ text: "AE", hostedUrl: "https://x/2", categories: { location: "NYC" }, createdAt: 0 }])[0]).toMatchObject({ title: "AE", location: "NYC" });
    expect(parseBoard("ashby", { jobs: [{ title: "RevOps", jobUrl: "https://x/3" }] })[0]).toMatchObject({ title: "RevOps", url: "https://x/3" });
  });
  it("matches role keywords case-insensitively", () => {
    expect(matchesRoles("Senior Account Executive", ["account executive"])).toBe(true);
    expect(matchesRoles("Designer", ["sales"])).toBe(false);
    expect(matchesRoles("Anything", [])).toBe(true);
  });
  it("formats ISO weeks", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(new Date("2026-10-07T00:00:00Z"))).toBe("2026-W41");
  });
  it("parses RSS items", () => {
    const items = parseFeed(`<rss><channel><item><title><![CDATA[Acme raises $10M Series A]]></title><link>https://news/1</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate><description>Big round</description></item></channel></rss>`);
    expect(items[0]).toMatchObject({ title: "Acme raises $10M Series A", link: "https://news/1", description: "Big round" });
    expect(items[0].pubDate).toBe("2026-10-06T10:00:00.000Z");
  });
  it("treats legal-suffix variants as the same employer", () => {
    expect(sameCompany("Acme Inc.", "acme")).toBe(true);
    expect(sameCompany("Acme", "Globex")).toBe(false);
    expect(sameCompany(null, "Globex")).toBe(true);
  });
});

describe("enrichment helpers and rule fit", () => {
  it("builds common email patterns", () => {
    expect(emailPatterns({ firstName: "José", lastName: "de la Cruz", domain: "www.acme.com" })).toContain("jose.cruz@acme.com");
    expect(emailPatterns({ firstName: "Ann", lastName: null, domain: "acme.com" })).toEqual(["ann@acme.com"]);
    expect(emailPatterns({ firstName: "Ann", lastName: "Lee", domain: null })).toEqual([]);
  });
  it("extracts domains", () => {
    expect(domainFrom("https://www.acme.com/about")).toBe("acme.com");
    expect(domainFrom("acme")).toBeNull();
  });
  it("scores persona title overlap without AI", () => {
    expect(ruleFit({ title: "VP Sales", headline: null }, icp).verdict).toBe("strong");
    expect(ruleFit({ title: "Designer", headline: null }, icp).verdict).toBe("poor");
    expect(ruleFit({ title: "x", headline: null }, null).fit_score).toBe(50);
  });
  it("builds a Sales Nav keyword search URL", () => {
    expect(salesNavSearchUrl("\"VP Sales\" AND SaaS")).toContain("/sales/search/people?query=(keywords%3A");
  });
});

describe("active hours", () => {
  const acct = { active_hours_start: 9, active_hours_end: 18, timezone: "UTC", working_days: "1,2,3,4,5" };
  it("respects hours and working days", () => {
    expect(withinActiveHours(acct, new Date("2026-10-07T10:00:00Z"))).toBe(true); // Wednesday
    expect(withinActiveHours(acct, new Date("2026-10-07T20:00:00Z"))).toBe(false);
    expect(withinActiveHours(acct, new Date("2026-10-10T10:00:00Z"))).toBe(false); // Saturday
  });
});
