import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { upsertLead } from "@/lib/signals/leads";
import { TregError, tregCall } from "@/lib/treg/client";
import { currentPosition, profileUrlFor, toPostRef, tregPostEngagers } from "@/lib/treg/linkedin";
import { headcountRange, icypeasQuery, leadFromRow } from "@/lib/treg/people";
import { enrichNeedsDataViaTreg } from "@/lib/treg/enrich";
import { sourceNeedsLinkedIn } from "@/lib/agents/store";
import type { Icp } from "@/lib/icp/schema";

const WS = "ws-treg";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeAll(() => { getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS); });
beforeEach(() => { process.env.TREG_API_KEY = "trg_test"; delete process.env.TREG_DAILY_CAP_USD; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TREG_API_KEY; });

describe("treg client", () => {
  it("authenticates, caps the cost, tags the workspace and logs what it cost", async () => {
    const fetchMock = vi.fn(async () => json(200, { output: { ok: true } }, { "X-Treg-Cost-Micro": "1200", "X-Treg-Served-By": "anyapi" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await tregCall("treg.linkedin.user.profile", { workspaceId: WS, purpose: "profile", body: { linkedin_url: "x" }, maxCostUsd: 0.02 });
    expect(r.costMicro).toBe(1200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://treg.to/call/treg.linkedin.user.profile");
    const h = init.headers as Record<string, string>;
    expect(h["X-Treg-Token"]).toBe("trg_test");
    expect(h["X-Treg-Route-Max-Cost"]).toBe("0.02");
    expect(h["X-Treg-Meta"]).toContain(`workspace=${WS}`);
    expect((getDb().prepare("SELECT cost_micro, served_by FROM treg_calls WHERE workspace_id = ? ORDER BY created_at DESC").get(WS))).toMatchObject({ cost_micro: 1200, served_by: "anyapi" });
  });

  it("maps errors and enforces the daily cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(402, { error: "insufficient_balance" })));
    await expect(tregCall("x", { workspaceId: WS, purpose: "t" })).rejects.toMatchObject({ code: "balance", blocking: true });
    vi.stubGlobal("fetch", vi.fn(async () => json(429, {})));
    await expect(tregCall("x", { workspaceId: WS, purpose: "t" })).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    process.env.TREG_DAILY_CAP_USD = "0.001"; // already spent $0.0012 above
    await expect(tregCall("x", { workspaceId: WS, purpose: "t" })).rejects.toBeInstanceOf(TregError);
  });
});

describe("treg LinkedIn parsing", () => {
  it("normalises stored profile URLs (Sales Navigator suffixes, queries)", () => {
    expect(profileUrlFor("https://linkedin.com/in/ACwAAAAFRIcB,NAME_SEARCH,8f6m")).toBe("https://www.linkedin.com/in/ACwAAAAFRIcB");
    expect(profileUrlFor("https://www.linkedin.com/in/jane-doe/?utm=x")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(profileUrlFor("https://www.linkedin.com/company/acme")).toBeNull();
  });

  it("reads posts from vendor rows of different shapes", () => {
    expect(toPostRef({ urn: "urn:li:activity:7300000000000000000", commentary: "Hello", posted_at: "2026-10-01T10:00:00Z" })).toMatchObject({ activityUrn: "urn:li:activity:7300000000000000000", text: "Hello", postedAt: "2026-10-01T10:00:00.000Z" });
    expect(toPostRef({ shareUrn: "urn:li:share:123", text: { text: "Hi" }, url: "https://x/post" })).toMatchObject({ activityUrn: "urn:li:share:123", text: "Hi", url: "https://x/post" });
    expect(toPostRef({ title: "no urn here" })).toBeNull();
  });

  it("turns post engagement into engagers, a comment beating a reaction from the same person", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      post: "urn:li:activity:1",
      reactions: [
        { reactionType: "LIKE", actor: { urn: "urn:li:fsd_profile:A", name: "Ada Lovelace", headline: "CTO", profileUrl: "https://www.linkedin.com/in/ada" } },
        { reactionType: "PRAISE", actor: { urn: "urn:li:fsd_profile:B", name: "Grace Hopper", headline: "VP Eng", profileUrl: "https://www.linkedin.com/in/grace" } },
      ],
      comments: [{ urn: "c1", text: "Great point", author: { id: "A", name: "Ada Lovelace", headline: "CTO", profileUrl: "https://www.linkedin.com/in/ada" } }],
    })));
    const es = await tregPostEngagers(WS, { activityUrn: "urn:li:activity:1", text: "", postedAt: null, url: "" });
    expect(es).toHaveLength(2);
    expect(es.find((e) => e.name === "Ada Lovelace")).toMatchObject({ kind: "comment", commentText: "Great point", firstName: "Ada", lastName: "Lovelace" });
    expect(es.find((e) => e.name === "Grace Hopper")).toMatchObject({ kind: "reaction", reactionType: "PRAISE", profileUrl: "https://www.linkedin.com/in/grace" });
  });

  it("finds the current job in a vendor's raw profile", () => {
    expect(currentPosition({ experience: [{ title: "CEO", company: "NewCo", start: { year: 2026, month: 3 }, end: null }, { title: "VP", company: "OldCo", end: { year: 2025 } }] }))
      .toMatchObject({ company: "NewCo", title: "CEO", started: "2026-03-01" });
    expect(currentPosition({ data: { positions: [{ title: "Founder", companyName: "Acme · Full-time", isCurrent: true }] } })?.company).toBe("Acme");
  });
});

describe("treg people search", () => {
  const icp = { personas: [{ titles: ["VP of Sales", "Head of Sales"] }], geographies: ["US"], industries: ["Software"], company_sizes: ["11-50", "51-200"], exclusions: ["intern"] } as unknown as Icp;
  it("builds an Icypeas query from the ICP", () => {
    expect(headcountRange(["11-50", "51-200"])).toEqual({ ">=": 11, "<=": 200 });
    expect(headcountRange(["1,001-5,000", "10,000+"])).toEqual({ ">=": 1001 });
    expect(icypeasQuery(icp)).toMatchObject({
      currentJobTitle: { include: ["VP of Sales", "Head of Sales"], exclude: ["intern"] },
      location: { include: ["US"] }, "currentCompany.headcount": { ">=": 11, "<=": 200 },
    });
    // "Software" is mapped to the industry names the leads database uses.
    expect((icypeasQuery(icp)!["currentCompany.industry"] as { include: string[] }).include).toContain("Software Development");
    expect(icypeasQuery({ ...icp, personas: [] } as unknown as Icp)).toBeNull();
  });
  it("maps result rows to leads", () => {
    expect(leadFromRow({ name: "Ada L", headline: "VP Sales", url: "https://www.linkedin.com/in/ada-l", currentJobTitle: "VP Sales", currentCompanyName: "Acme", location: "US" }))
      .toMatchObject({ name: "Ada L", profileUrl: "https://www.linkedin.com/in/ada-l", title: "VP Sales", company: "Acme" });
    expect(leadFromRow({ name: "No URL" })).toBeNull();
  });
});

describe("treg routing and enrichment", () => {
  it("takes engagement, topic, lookalike and job-change sources off the LinkedIn session when configured", () => {
    expect(sourceNeedsLinkedIn("competitor_engagement")).toBe(false);
    expect(sourceNeedsLinkedIn("hiring")).toBe(false);
    delete process.env.TREG_API_KEY;
    expect(sourceNeedsLinkedIn("competitor_engagement")).toBe(true);
    expect(sourceNeedsLinkedIn("keyword_engagement")).toBe(true);
  });

  it("fills headline and about for needs_data leads", async () => {
    const db = getDb();
    const id = upsertLead(db, WS, null, { name: "Thin Lead", profileUrl: "https://www.linkedin.com/in/thin-lead" }).targetId;
    db.prepare("UPDATE targets SET agent_status = 'needs_data', headline = NULL, summary = NULL, linkedin_url = 'https://linkedin.com/in/ACwThin,NAME_SEARCH,x' WHERE id = ?").run(id);
    const fetchMock = vi.fn(async () => json(200, { output: { full_name: "Thin Lead", headline: "Head of Growth at Acme", about: "I grow things", location: "Berlin" }, raw: { experience: [{ title: "Head of Growth", company: "Acme", end: null }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await enrichNeedsDataViaTreg(db, 10, WS);
    expect(r).toMatchObject({ attempted: 1, filled: 1 });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].body))).toEqual({ linkedin_url: "https://www.linkedin.com/in/ACwThin" });
    expect(db.prepare("SELECT headline, summary, company, enriched_profile_at IS NOT NULL done FROM targets WHERE id = ?").get(id)).toMatchObject({ headline: "Head of Growth at Acme", summary: "I grow things", company: "Acme", done: 1 });
  });
});

describe("company enrichment before scoring", () => {
  it("reads photo, company page and funding once, and puts a recent round on the lead as a signal", async () => {
    const db = getDb();
    const a = upsertLead(db, WS, null, { name: "Fran Funded", profileUrl: "https://www.linkedin.com/in/fran-funded" }).targetId;
    const b = upsertLead(db, WS, null, { name: "Gus Funded", profileUrl: "https://www.linkedin.com/in/gus-funded" }).targetId;
    const announced = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      const u = String(url); calls.push(u);
      if (u.includes("user.profile")) return json(200, {
        output: { full_name: "Fran Funded", headline: "Head of Sales at Fundco", about: null, location: "Paris" },
        raw: { output: { data: { profilePictureUrl: "https://media.licdn.com/p.jpg", experience: [{ title: "Head of Sales", company: "Fundco", companyUrl: "https://www.linkedin.com/company/fundco/", endDate: "" }] } } },
      });
      if (u.includes("company.profile")) return json(200, {
        output: { name: "Fundco", description: "Sales software", website: "https://fundco.io", employees: 42, location: "Paris", linkedin_url: "https://www.linkedin.com/company/fundco" },
        raw: { data: { industries: "Software Development", logo: "https://media.licdn.com/logo.png", founded: 2019, specialties: "Sales, CRM", company_size: "11-50 employees", organization_type: "Privately Held" } },
      });
      return json(200, { fundingRounds: [{ id: 7, announcedOn: announced, moneyRaised: 2_900_000, name: "Seed Round", stage: "Seed" }, { id: 3, announcedOn: "2020-01-01T00:00:00Z", stage: "Pre-seed" }] });
    }));
    const { enrichForScoring } = await import("@/lib/treg/enrich");
    expect(await enrichForScoring(db, WS, [a, b])).toBe(2);
    // One company page and one funding lookup, shared by both leads.
    expect(calls.filter((u) => u.includes("company.profile"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("funding_rounds"))).toHaveLength(1);
    expect(db.prepare("SELECT profile_image_url FROM targets WHERE id = ?").get(a)).toEqual({ profile_image_url: "https://media.licdn.com/p.jpg" });
    expect(db.prepare("SELECT c.logo_url, c.founded_year, c.specialties, c.employee_range, c.org_type, c.industry, c.domain FROM targets t JOIN companies c ON c.id = t.company_id WHERE t.id = ?").get(b))
      .toEqual({ logo_url: "https://media.licdn.com/logo.png", founded_year: 2019, specialties: "Sales, CRM", employee_range: "11-50 employees", org_type: "Privately Held", industry: "Software Development", domain: "fundco.io" });
    const sig = db.prepare("SELECT type, title, snippet FROM signals WHERE target_id = ? AND type = 'funding'").get(a) as { title: string; snippet: string };
    expect(sig.title).toMatch(/^Raised funding · \w+ \d{4}$/);
    expect(sig.snippet).toBe("Seed · $2.9M");
    expect(db.prepare("SELECT COUNT(*) n FROM signals WHERE target_id = ? AND type = 'funding'").get(b)).toEqual({ n: 1 });
  });
});

describe("treg-backed signal runner", () => {
  it("topic activity: searches posts, reads engagers and emits leads without a LinkedIn session", async () => {
    const { keywordRunner } = await import("@/lib/signals/sources/engagement");
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => String(url).includes("search.posts")
      ? json(200, { data: [{ urn: "urn:li:activity:7380000000000000000", text: "Outbound is changing", posted_at: new Date().toISOString() }] })
      : json(200, { reactions: [{ reactionType: "LIKE", actor: { urn: "u1", name: "Lin Kedin", headline: "SDR Manager", profileUrl: "https://www.linkedin.com/in/lin" } }], comments: [] })));
    const emitted: Array<{ name: string; title: string }> = [];
    const ctx = {
      workspaceId: WS, config: { keywords: ["outbound"], urls: [], posts_per_entity: 3, max_engagers_per_post: 50 }, cursor: {}, icp: null,
      isFull: () => false, emitLead: (c: { name: string }, s: { title: string }) => { emitted.push({ name: c.name, title: s.title }); return "ingested"; },
    } as unknown as Parameters<typeof keywordRunner>[0];
    await keywordRunner(ctx);
    expect(emitted).toEqual([{ name: "Lin Kedin", title: 'Reacted to a post about "outbound"' }]);
  });
});
