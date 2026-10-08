import { randomUUID } from "crypto";
import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { companyIdOf, hasCompanyProfile, linkKnownCompany, parseSalesCompany, saveCompanyForTarget } from "@/lib/linkedin/company-profile";
import { signalLine } from "@/components/agents/signal-line";

/** The lead's company is read once per workspace and shared; signals read as one sentence. */

const WS = "00000000-0000-4000-8000-000000000001";

function lead(): string {
  const id = randomUUID();
  getDb().prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url) VALUES (?, ?, ?, ?)").run(id, WS, "Kat Bell", `https://www.linkedin.com/in/kat-${id}`);
  return id;
}

describe("parseSalesCompany", () => {
  it("reads the Sales Navigator company payload", () => {
    const p = parseSalesCompany({
      entityUrn: "urn:li:fs_salesCompany:4242",
      name: "Ivybrook Academy",
      description: "Founded by a former schoolteacher…",
      industry: "Education",
      employeeCountRange: { start: 501, end: 1000 },
      headquarters: { city: "Rock Hill", geographicArea: "South Carolina", country: "United States" },
      website: "ivybrookacademy.com",
      companyPictureDisplayImage: { rootUrl: "https://media.licdn.com/dms/image/L/", artifacts: [{ width: 100, fileIdentifyingUrlPathSegment: "logo_100.png" }] },
    });
    expect(p).toMatchObject({
      name: "Ivybrook Academy", industry: "Education", employeeRange: "501–1,000 employees",
      location: "Rock Hill, South Carolina, United States", website: "https://ivybrookacademy.com",
      linkedinUrl: "https://www.linkedin.com/company/4242", logoUrl: "https://media.licdn.com/dms/image/L/logo_100.png",
    });
    expect(parseSalesCompany({ description: "no name" })).toBeNull();
  });

  it("finds the company id in a URN or company URL", () => {
    expect(companyIdOf("https://www.linkedin.com/company/4242")).toBe("4242");
    expect(companyIdOf("urn:li:fs_salesCompany:77")).toBe("77");
    expect(companyIdOf("https://www.linkedin.com/company/acme")).toBeNull();
  });
});

describe("saveCompanyForTarget", () => {
  it("stores the company once per workspace and links every colleague to it", () => {
    const db = getDb();
    const url = `https://www.linkedin.com/company/${Math.floor(Math.random() * 1e9)}`;
    const a = lead(); const b = lead();
    expect(hasCompanyProfile(db, WS, url)).toBe(false);
    const id = saveCompanyForTarget(db, a, { name: "Hyperplan", description: "Remote sensing", industry: "Software", employeeRange: "11–50 employees", employeeCount: null, location: "Paris", website: "https://hyperplan.io", linkedinUrl: url, logoUrl: null });
    expect(id).toBeTruthy();
    expect(hasCompanyProfile(db, WS, url)).toBe(true);
    expect(linkKnownCompany(db, b, url)).toBe(true);
    const rows = db.prepare("SELECT company_id FROM targets WHERE id IN (?, ?)").all(a, b) as Array<{ company_id: string }>;
    expect(rows.every((r) => r.company_id === id)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM companies WHERE workspace_id = ? AND linkedin_url = ?").get(WS, url) as { n: number }).n).toBe(1);
    const c = db.prepare("SELECT domain, employee_range FROM companies WHERE id = ?").get(id) as { domain: string; employee_range: string };
    expect(c).toEqual({ domain: "hyperplan.io", employee_range: "11–50 employees" });
  });
});

describe("signalLine", () => {
  const base = { snippet: null, source_url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" };
  it("phrases engagement like the drawer shows it", () => {
    expect(signalLine({ ...base, type: "competitor_engagement", title: "Reacted to lemlist's post" })).toMatchObject({ lead: "Just engaged with a ", link: "competitor", sub: "Competitor: lemlist", href: base.source_url });
    expect(signalLine({ ...base, type: "keyword_engagement", title: 'Reacted to a post about "multichannel outreach"' })).toMatchObject({ link: "LinkedIn post", sub: 'Keyword: "multichannel outreach"' });
    expect(signalLine({ ...base, type: "keyword_engagement", title: 'Commented on a post about "ICP"', metadata_json: JSON.stringify({ engagement: "comment" }) }).lead).toBe("Commented on a ");
  });
  it("counts hiring roles and falls back to the title", () => {
    expect(signalLine({ ...base, type: "hiring", title: "Acme is hiring: SDR", metadata_json: JSON.stringify({ roles: [{ title: "SDR" }, { title: "AE" }] }) })).toMatchObject({ lead: "Hiring for ", link: "2 roles", sub: "SDR · AE" });
    expect(signalLine({ ...base, type: "funding", title: "Acme raised $5M Seed" })).toMatchObject({ lead: "Acme raised $5M Seed", link: null });
  });
});
