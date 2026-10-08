import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { Page } from "playwright";
import { companyUrlFromUrn, linkedInImageUrl } from "@/lib/linkedin/images";

/**
 * The lead's current company, read from Sales Navigator's own company API (the call the
 * Sales Nav company card makes) and kept once per workspace in `companies`, so every lead at
 * that company shares it and it is fetched at most once.
 */

export interface CompanyProfile {
  name: string;
  description: string | null;
  industry: string | null;
  employeeRange: string | null;
  employeeCount: number | null;
  location: string | null;
  website: string | null;
  linkedinUrl: string | null;
  logoUrl: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function place(v: unknown): string | null {
  if (typeof v === "string") return s(v);
  if (!isObj(v)) return null;
  const parts = [v.city, v.geographicArea, v.country].map(s).filter(Boolean);
  return parts.length ? parts.join(", ") : s(v.line1) ?? s(v.displayName);
}

function range(v: unknown): string | null {
  if (typeof v === "string") return s(v);
  if (!isObj(v)) return null;
  const start = typeof v.start === "number" ? v.start : null;
  const end = typeof v.end === "number" ? v.end : null;
  if (start !== null && end !== null) return `${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} employees`;
  if (start !== null) return `${start.toLocaleString("en-US")}+ employees`;
  return null;
}

/** Tolerant parse of a salesApiCompanies response (flat or {data, included}). */
export function parseSalesCompany(json: unknown): CompanyProfile | null {
  if (!isObj(json)) return null;
  const c = isObj(json.data) && "name" in json.data ? json.data : json;
  const name = s(c.name);
  if (!name) return null;
  const count = typeof c.employeeCount === "number" ? c.employeeCount : typeof c.employeeDisplayCount === "number" ? c.employeeDisplayCount : null;
  const rangeText = range(c.employeeCountRange) ?? s(c.employeeDisplayCount) ?? (count ? `${count.toLocaleString("en-US")} employees` : null);
  const website = s(c.website);
  return {
    name,
    description: s(c.description),
    industry: s(c.industry) ?? (Array.isArray(c.industries) ? s(c.industries[0]) : null),
    employeeRange: rangeText,
    employeeCount: count,
    location: place(c.headquarters) ?? place(c.location),
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
    linkedinUrl: s(c.flagshipCompanyUrl) ?? companyUrlFromUrn(c.entityUrn),
    logoUrl: linkedInImageUrl(c.companyPictureDisplayImage ?? c.logo ?? c.pictureInfo, 100),
  };
}

/** Company id from "urn:li:fs_salesCompany:1234" or a /company/1234 URL. */
export function companyIdOf(urnOrUrl: string | null | undefined): string | null {
  return urnOrUrl?.match(/(?::|\/company\/)(\d+)\/?\)?$/)?.[1] ?? null;
}

/** Read this company in the last 30 days (even if it came back sparse)? Older reads are refreshed. */
export function hasCompanyProfile(db: Database.Database, workspaceId: string, linkedinUrl: string): boolean {
  return !!db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND linkedin_url = ? AND profile_fetched_at > datetime('now', '-30 days')").get(workspaceId, linkedinUrl);
}

/** Store the company once per workspace and point the lead at it. */
export function saveCompanyForTarget(db: Database.Database, targetId: string, p: CompanyProfile): string | null {
  const t = db.prepare("SELECT workspace_id FROM targets WHERE id = ?").get(targetId) as { workspace_id: string } | undefined;
  if (!t || !p.linkedinUrl) return null;
  const domain = p.website ? p.website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() : null;
  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM companies WHERE workspace_id = ? AND linkedin_url = ?").get(t.workspace_id, p.linkedinUrl) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    if (existing) {
      db.prepare(`UPDATE companies SET name = ?, description = COALESCE(?, description), industry = COALESCE(?, industry), employee_range = COALESCE(?, employee_range),
          employee_count = COALESCE(?, employee_count), location = COALESCE(?, location), website = COALESCE(?, website), domain = COALESCE(domain, ?),
          logo_url = COALESCE(?, logo_url), profile_fetched_at = datetime('now') WHERE id = ?`)
        .run(p.name, p.description, p.industry, p.employeeRange, p.employeeCount, p.location, p.website, domain, p.logoUrl, id);
    } else {
      db.prepare(`INSERT INTO companies (id, workspace_id, name, description, industry, employee_range, employee_count, location, website, domain, linkedin_url, logo_url, profile_fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(id, t.workspace_id, p.name, p.description, p.industry, p.employeeRange, p.employeeCount, p.location, p.website, domain, p.linkedinUrl, p.logoUrl);
    }
    db.prepare(`UPDATE targets SET company_id = ?, company_linkedin_url = COALESCE(company_linkedin_url, ?), company_logo_url = COALESCE(?, company_logo_url),
        company_industry = COALESCE(company_industry, ?) WHERE id = ?`).run(id, p.linkedinUrl, p.logoUrl, p.industry, targetId);
    return id;
  })();
}

/** Link the lead to a company already stored for its LinkedIn page, without fetching. */
export function linkKnownCompany(db: Database.Database, targetId: string, linkedinUrl: string): boolean {
  const r = db.prepare(`UPDATE targets SET company_id = (SELECT c.id FROM companies c WHERE c.workspace_id = targets.workspace_id AND c.linkedin_url = ?)
    WHERE id = ? AND EXISTS (SELECT 1 FROM companies c WHERE c.workspace_id = targets.workspace_id AND c.linkedin_url = ?)`).run(linkedinUrl, targetId, linkedinUrl);
  return r.changes > 0;
}

/** One read of salesApiCompanies from inside an open Sales Navigator page (session cookies + csrf). */
export async function fetchSalesCompany(page: Page, companyId: string): Promise<CompanyProfile | null> {
  const cookies = await page.context().cookies("https://www.linkedin.com");
  const csrf = cookies.find((c) => c.name === "JSESSIONID")?.value?.replace(/"/g, "") ?? "";
  if (!csrf || !/^\d+$/.test(companyId)) return null;
  const result = await page.evaluate(async ({ url, csrfToken }: { url: string; csrfToken: string }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(url, { credentials: "include", signal: controller.signal, headers: { "csrf-token": csrfToken, "x-restli-protocol-version": "2.0.0", accept: "application/json" } });
      clearTimeout(timer);
      return { status: resp.status, body: resp.status === 200 ? await resp.text() : "" };
    } catch { return { status: 0, body: "" }; }
  }, { url: `https://www.linkedin.com/sales-api/salesApiCompanies/${companyId}`, csrfToken: csrf });
  if (result.status !== 200) return null;
  try { return parseSalesCompany(JSON.parse(result.body)); } catch { return null; }
}
