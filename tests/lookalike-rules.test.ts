import { describe, expect, it } from "vitest";
import {
  lookalikeSearchUrl, matchScore, parseFlagshipProfile, publicIdFromUrl, rankLookalikes, type LookalikeCandidate, type LookalikeScope,
} from "@/lib/agents/lookalike-rules";

const scope: LookalikeScope = {
  title: "VP of Sales", similarTitles: ["Chief Sales Officer"], includeSimilarRoles: true,
  location: "South Delhi, Delhi, India", geoId: "105556991", industry: "IT Services and IT Consulting", industryId: "96",
  relatedIndustries: false, sizes: ["201-500 employees"],
};

const candidate = (over: Partial<LookalikeCandidate>): LookalikeCandidate => ({
  salesNavUrn: "urn:li:fs_salesProfile:(A,NAME_SEARCH,x)", salesNavUrl: "https://www.linkedin.com/sales/lead/A", fullName: "Jane Doe",
  title: "VP of Sales", company: "Acme", location: "South Delhi, Delhi, India", companyIndustry: "IT Services and IT Consulting",
  profileImageUrl: null, linkedinUrl: null, ...over,
});

describe("publicIdFromUrl", () => {
  it("accepts LinkedIn profile URLs and rejects anything else", () => {
    expect(publicIdFromUrl("https://www.linkedin.com/in/shadab-khan-8445b4b/")).toBe("shadab-khan-8445b4b");
    expect(publicIdFromUrl("linkedin.com/in/jane_doe?utm=1")).toBe("jane_doe");
    expect(publicIdFromUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(publicIdFromUrl("https://example.com/in/jane")).toBeNull();
    expect(publicIdFromUrl("not a url")).toBeNull();
  });
});

describe("parseFlagshipProfile", () => {
  const body = JSON.stringify({
    included: [
      { $type: "com.linkedin.voyager.dash.identity.profile.Profile", entityUrn: "urn:li:fsd_profile:1", publicIdentifier: "shadab-khan", firstName: "Shadab", lastName: "Khan",
        headline: "VP of Sales at Intensity", geoLocation: { geoUrn: "urn:li:fsd_geo:105556991" }, industryUrn: "urn:li:fsd_industry:96" },
      { entityUrn: "urn:li:fsd_geo:105556991", defaultLocalizedName: "South Delhi, Delhi, India" },
      { entityUrn: "urn:li:fsd_industry:96", name: "IT Services and IT Consulting" },
      { $type: "com.linkedin.voyager.dash.identity.profile.Position", title: "Sales Manager", companyName: "Old Co", dateRange: { end: { year: 2020 } } },
      { $type: "com.linkedin.voyager.dash.identity.profile.Position", title: "VP of Sales", companyName: "Intensity Global Technologies Limited", dateRange: { start: { year: 2021 } } },
    ],
  });

  it("reads name, current role, location and industry with their search ids", () => {
    expect(parseFlagshipProfile(["not json", body], "Shadab-Khan")).toMatchObject({
      name: "Shadab Khan", title: "VP of Sales", company: "Intensity Global Technologies Limited",
      location: "South Delhi, Delhi, India", geoId: "105556991", industry: "IT Services and IT Consulting", industryId: "96",
      linkedinUrl: "https://www.linkedin.com/in/Shadab-Khan/",
    });
  });

  it("falls back to the headline when there are no positions, and returns null for someone else", () => {
    const thin = JSON.stringify({ data: { publicIdentifier: "jane", firstName: "Jane", headline: "Head of Growth at Acme" } });
    expect(parseFlagshipProfile([thin], "jane")).toMatchObject({ title: "Head of Growth", company: "Acme", geoId: null });
    expect(parseFlagshipProfile([body], "someone-else")).toBeNull();
  });
});

describe("lookalikeSearchUrl", () => {
  it("builds a Sales Navigator search with title, region, industry and headcount filters", () => {
    const url = lookalikeSearchUrl(scope);
    expect(url).toMatch(/^https:\/\/www\.linkedin\.com\/sales\/search\/people\?query=/);
    expect(url).toContain("type:CURRENT_TITLE");
    expect(url).toContain("text:VP%20of%20Sales");
    expect(url).toContain("text:Chief%20Sales%20Officer");
    expect(url).toContain("(id:105556991,");
    expect(url).toContain("type:INDUSTRY,values:List((id:96,");
    expect(url).toContain("type:COMPANY_HEADCOUNT,values:List((id:E,");
  });

  it("drops the industry filter for related industries and similar titles when switched off", () => {
    const url = lookalikeSearchUrl({ ...scope, relatedIndustries: true, includeSimilarRoles: false });
    expect(url).not.toContain("INDUSTRY");
    expect(url).not.toContain("Chief");
  });

  it("strips rest.li syntax characters from free text", () => {
    expect(lookalikeSearchUrl({ ...scope, title: "VP, Sales (APAC): Lead" })).toContain("text:VP%20Sales%20APAC%20Lead");
  });
});

describe("ranking", () => {
  it("scores an exact match 100 and weaker matches lower", () => {
    expect(matchScore(candidate({}), scope)).toBe(100);
    expect(matchScore(candidate({ location: "London, UK" }), scope)).toBeLessThan(100);
    expect(matchScore(candidate({ title: "Software Engineer", location: "London", companyIndustry: "Banking" }), scope)).toBeLessThan(50);
  });

  it("drops the seed person and duplicates, best match first", () => {
    const leads = rankLookalikes([
      candidate({ salesNavUrn: "a", fullName: "Weak", title: "Engineer" }),
      candidate({ salesNavUrn: "b", fullName: "Shadab Khan" }),
      candidate({ salesNavUrn: "c", fullName: "Strong" }),
      candidate({ salesNavUrn: "c", fullName: "Strong again" }),
    ], scope, "shadab khan");
    expect(leads.map((l) => l.name)).toEqual(["Strong", "Weak"]);
  });
});

describe("profile page parsing", () => {
  it("reads the current role and company link from Experience, ignoring suggestion links", async () => {
    const { currentRoleFromExperience } = await import("@/lib/agents/lookalike-rules");
    const role = currentRoleFromExperience([
      { href: "https://www.linkedin.com/company/6442668/", text: "VP of Sales\n\nIntensity Global Technologies Limited · Full-time\n\nSep 2025 - Present · 1 yr 2 mos\n\nNew Delhi, Delhi, India · On-site" },
      { href: "https://www.linkedin.com/company/529134/", text: "Regional Business Head\n\nCubix Networks Pvt Ltd · Full-time\n\nJan 2006 - Sep 2025 · 19 yrs 9 mos" },
      { href: "https://www.linkedin.com/company/amazon/", text: "Amazon\n\nSoftware Development\n\n37,483,472 followers" },
    ]);
    expect(role).toEqual({ title: "VP of Sales", company: "Intensity Global Technologies Limited", companyUrl: "https://www.linkedin.com/company/6442668/" });
  });

  it("handles several roles grouped under one company", async () => {
    const { currentRoleFromExperience } = await import("@/lib/agents/lookalike-rules");
    expect(currentRoleFromExperience([
      { href: "https://www.linkedin.com/company/acme/?x=1", text: "Acme Corp\nFull-time · 5 yrs 2 mos\nHead of Sales\nJan 2023 - Present · 2 yrs" },
    ])).toEqual({ title: "Head of Sales", company: "Acme Corp", companyUrl: "https://www.linkedin.com/company/acme/" });
  });

  it("reads industry and headcount from a company top card", async () => {
    const { companyFacts, sizeBucket } = await import("@/lib/agents/lookalike-rules");
    expect(companyFacts(["IT Services and IT Consulting", "New Delhi, New Delhi", "5K followers", "201-500 employees"])).toEqual({ industry: "IT Services and IT Consulting", size: "201-500 employees" });
    expect(sizeBucket("10,001+ employees")).toBe("10000+ employees");
    expect(sizeBucket("2-10 employees")).toBe("1-10 employees");
    expect(sizeBucket("no headcount")).toBeNull();
  });
});

describe("regular LinkedIn search (no Sales Navigator)", () => {
  it("builds a boolean title query with the city, or a geo filter when the id is known", async () => {
    const { flagshipSearchUrl, isFlagshipSearchUrl } = await import("@/lib/agents/lookalike-rules");
    const url = flagshipSearchUrl({ ...scope, geoId: null });
    expect(isFlagshipSearchUrl(url)).toBe(true);
    expect(new URL(url).searchParams.get("keywords")).toBe('("VP of Sales" OR "Chief Sales Officer") South Delhi');
    const geo = new URL(flagshipSearchUrl(scope, 3));
    expect(geo.searchParams.get("keywords")).not.toContain("Delhi");
    expect(geo.searchParams.get("geoUrn")).toBe('["105556991"]');
    expect(geo.searchParams.get("page")).toBe("3");
  });

  it("parses result cards, preferring the Current: line for title and company", async () => {
    const { parseSearchCards } = await import("@/lib/agents/lookalike-rules");
    const people = parseSearchCards([
      { href: "https://www.linkedin.com/in/sunil-sharma?mini=1", text: "Sunil Sharma\n • 3rd+\n\nManaging Director & VP - Sales, Sophos\n\nSouth Delhi, Delhi, India\n\nFollow\n\nCurrent: Vice President - Sales (India & SAARC) at Sophos\n\n6,573 followers" },
      { href: "https://www.linkedin.com/in/rajendar", text: "Rajendar Kumar • 3rd+\n\nVP Sales at Likraft\n\nGurugram, Haryana, India\n\nMessage\n\nPast: VP of Sales & Marketing at Likraft Battery" },
      { href: "https://www.linkedin.com/company/acme", text: "Acme" },
    ]);
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({ fullName: "Sunil Sharma", title: "Vice President - Sales (India & SAARC)", company: "Sophos", location: "South Delhi, Delhi, India", linkedinUrl: "https://www.linkedin.com/in/sunil-sharma/" });
    expect(people[1]).toMatchObject({ fullName: "Rajendar Kumar", title: "VP Sales", company: "Likraft", location: "Gurugram, Haryana, India" });
  });

  it("treats VP and Vice President as the same title and scores without industry", () => {
    expect(matchScore(candidate({ title: "Vice President of Sales", companyIndustry: null }), scope)).toBe(100);
  });
});

describe("company sizes", () => {
  it("maps both size spellings to the Sales Navigator headcount code", () => {
    expect(lookalikeSearchUrl({ ...scope, sizes: ["201-500"] })).toContain("type:COMPANY_HEADCOUNT,values:List((id:E,");
    expect(lookalikeSearchUrl({ ...scope, sizes: ["201-500 employees", "10000+ employees"] })).toContain("(id:E,selectionType:INCLUDED),(id:I,");
  });
});
