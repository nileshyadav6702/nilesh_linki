import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseSignalStrength, flamesFor, priorityScore, recencyScore } from "@/lib/signals/scoring";
import { matchesPersona, prefilterLead } from "@/lib/signals/leads";
import { icypeasQuery, linkedinIndustries, tregPeopleSearch } from "@/lib/treg/people";
import { isQualified } from "@/lib/agents/fit";
import type { Icp } from "@/lib/icp/schema";

const icp = {
  company_name: "Heddl", match_mode: "high_precision", exclusions: ["intern", "recruiter", "Service providers, freelancers, consultants"], competitors: [],
  industries: ["Software & SaaS", "Technology"], company_sizes: ["1-10 employees", "11-50 employees"], geographies: [],
  personas: [{ titles: ["Head of Sales", "VP of Sales"] }, { titles: ["Sales Development Representative", "Account Executive"] }, { titles: ["Founder", "CEO"] }],
} as unknown as Icp;

describe("priority score", () => {
  it("weights fit 40, signal 30, recency 20, relevance 10", () => {
    expect(priorityScore({ fit: 95, signal: 90, recency: 90, relevance: 100 })).toBe(93);
    expect(priorityScore({ fit: 95, signal: 30, recency: 90, relevance: 100 })).toBe(75);
  });
  it("maps scores to flames: warm from 60, hot from 80", () => {
    expect([flamesFor(59), flamesFor(60), flamesFor(79.9), flamesFor(80)]).toEqual([1, 2, 2, 3]);
  });
  it("recency is full for two days, then halves every 14", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(recencyScore("2026-10-09T00:00:00Z", now)).toBe(100);
    expect(recencyScore("2026-09-24T00:00:00Z", now)).toBe(50);
    expect(recencyScore(null, now)).toBe(0);
  });
  it("signal strength from types: strongest type, plus corroboration", () => {
    expect(baseSignalStrength(["competitor_engagement"])).toBe(75);
    expect(baseSignalStrength(["lookalike"])).toBe(13);
    expect(baseSignalStrength(["competitor_engagement", "job_change"])).toBe(90);
    expect(baseSignalStrength([])).toBe(0);
  });
  it("qualifies on ICP fit alone", () => {
    expect(isQualified("strong", "high", 80, "high_precision")).toBe(true);
    expect(isQualified("possible", "high", 54, "high_precision")).toBe(false);
    expect(isQualified("poor", "high", 90, "high_precision")).toBe(false);
  });
});

describe("persona gate", () => {
  it("lets in the personas' roles and drops everyone else", () => {
    for (const h of ["SDR/BDR | Driving Sales Growth", "Mid-Market AE UKI | Samsara", "Head of Sales EMEA", "Co-Founder @ Acme", "Business Development Lead @ Rowden"]) expect(matchesPersona(h, icp)).toBe(true);
    for (const h of ["Collaborateur Comptable", "Machine Learning Engineer @Richemont", "HR Ops Specialist", "Senior Développeur Fullstack JS"]) expect(matchesPersona(h, icp)).toBe(false);
  });
  it("applies only when asked, and drops a monitored competitor's staff", () => {
    const lead = { name: "X", headline: "Machine Learning Engineer" };
    expect(prefilterLead(lead, { icp }).ok).toBe(true);
    expect(prefilterLead(lead, { icp, personaGate: true })).toEqual({ ok: false, reason: "Headline matches no target persona" });
    expect(prefilterLead({ name: "Y", headline: "Head of Sales at Lemlist" }, { icp, personaGate: true, excludeEmployeesOf: ["Lemlist"] })).toEqual({ ok: false, reason: "Works at Lemlist" });
  });
});

describe("lookalike people search", () => {
  beforeEach(() => { process.env.TREG_API_KEY = "trg_test"; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.TREG_API_KEY; });

  it("maps ICP industries to LinkedIn's names and keeps only short title exclusions", () => {
    expect(linkedinIndustries(["Software & SaaS", "Software Development", "Underwater basket weaving"])).toEqual(["Software Development", "Technology, Information and Internet", "IT Services and IT Consulting"]);
    // This ICP excludes service providers: IT-services firms are left out of the search.
    const ind = icypeasQuery(icp)!["currentCompany.industry"] as { include: string[]; exclude: string[] };
    expect(ind.include).not.toContain("IT Services and IT Consulting");
    expect(ind.exclude).toContain("IT Services and IT Consulting");
    const q = icypeasQuery(icp)!;
    expect(q.currentJobTitle).toEqual({ include: ["Head of Sales", "VP of Sales", "Sales Development Representative", "Account Executive", "Founder", "CEO"], exclude: ["intern", "recruiter"] });
    expect(q["currentCompany.headcount"]).toEqual({ ">=": 1, "<=": 50 });
  });

  it("searches again without the industry filter when it matches nobody, and keeps firmographics", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      const leads = body.query["currentCompany.industry"]?.include ? [] : [{ firstname: "Ada", lastname: "L", headline: "VP of Sales at Acme", profileUrl: "https://www.linkedin.com/in/ada", lastJobTitle: "VP of Sales", lastCompanyName: "Acme", lastCompanySize: 40, lastCompanyIndustry: "Software Development", lastCompanyWebsite: "https://acme.io", address: "Austin, Texas" }];
      return new Response(JSON.stringify({ success: true, total: leads.length, leads }), { status: 200 });
    }));
    const r = await tregPeopleSearch("ws", icp, 10);
    expect(bodies).toHaveLength(2);
    expect(r.leads[0]).toMatchObject({ name: "Ada L", title: "VP of Sales", company: "Acme", location: "Austin, Texas", companyInfo: { employeeCount: 40, industry: "Software Development", website: "https://acme.io" } });
  });
});
