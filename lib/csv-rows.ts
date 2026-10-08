/**
 * Pure CSV helpers shared by the browser (mapping + review preview) and lib/csv-import.ts
 * (the authoritative server import). No Node or DB imports: this file ships to the client.
 */

export const CSV_MAX_BYTES = 10 * 1024 * 1024;

/** Header normalisation the server importer applies (papaparse transformHeader). */
export const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_");

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Any linkedin.com/in/ URL (with or without protocol / www / trailing path) → https://www.linkedin.com/in/<slug>. */
export function canonicalProfileUrl(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
}

/** Contact fields the agent CSV import maps. `custom` ones are stored as custom fields. */
export interface CsvFieldDef { key: string; label: string; target: { kind: "standard"; field: string } | { kind: "custom"; key: string }; aliases: string[] }

export const MANDATORY_FIELDS: CsvFieldDef[] = [
  { key: "first_name", label: "First Name", target: { kind: "standard", field: "first_name" }, aliases: ["first_name", "firstname", "first", "given_name", "prenom"] },
  { key: "last_name", label: "Last Name", target: { kind: "standard", field: "last_name" }, aliases: ["last_name", "lastname", "last", "surname", "family_name", "nom"] },
  { key: "linkedin_url", label: "LinkedIn Profile URL", target: { kind: "standard", field: "linkedin_url" }, aliases: ["linkedin_url", "linkedin", "linkedin_profile", "linkedin_profile_url", "profile_url", "person_linkedin_url", "li_url"] },
];

export const OPTIONAL_FIELDS: CsvFieldDef[] = [
  { key: "headline", label: "Profile Baseline", target: { kind: "standard", field: "headline" }, aliases: ["headline", "profile_baseline", "baseline", "tagline"] },
  { key: "location", label: "Location", target: { kind: "standard", field: "location" }, aliases: ["location", "city_country", "region", "geo"] },
  { key: "title", label: "Job Title", target: { kind: "standard", field: "title" }, aliases: ["title", "job_title", "position", "role", "jobtitle"] },
  { key: "company", label: "Company Name", target: { kind: "standard", field: "company" }, aliases: ["company", "company_name", "organization", "organisation", "account", "employer"] },
  { key: "company_linkedin_url", label: "Company LinkedIn URL", target: { kind: "standard", field: "company_linkedin_url" }, aliases: ["company_linkedin_url", "company_linkedin", "company_url", "organization_linkedin_url"] },
  { key: "website", label: "Website", target: { kind: "custom", key: "website" }, aliases: ["website", "company_website", "domain", "url", "site"] },
  { key: "email", label: "Email", target: { kind: "standard", field: "email" }, aliases: ["email", "email_address", "e-mail", "work_email", "mail"] },
  { key: "phone", label: "Phone", target: { kind: "standard", field: "phone" }, aliases: ["phone", "phone_number", "mobile", "telephone", "tel"] },
  { key: "notes", label: "Internal Note", target: { kind: "standard", field: "notes" }, aliases: ["notes", "note", "internal_note", "comment", "comments"] },
  { key: "company_industry", label: "Industry", target: { kind: "standard", field: "company_industry" }, aliases: ["industry", "company_industry", "sector"] },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pick a column for each field by header similarity: exact alias, then squashed alias, then containment. */
export function autoMap(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const f of [...MANDATORY_FIELDS, ...OPTIONAL_FIELDS]) {
    const free = headers.filter((h) => !used.has(h));
    const aliases = f.aliases.map(squash);
    const hit = free.find((h) => f.aliases.includes(normalizeHeader(h)))
      ?? free.find((h) => aliases.includes(squash(h)))
      ?? free.find((h) => squash(h).length >= 4 && aliases.some((a) => a.length >= 5 && (squash(h).includes(a) || a.includes(squash(h)))));
    out[f.key] = hit ?? "";
    if (hit) used.add(hit);
  }
  return out;
}

/** Variable key for a custom column: "Deal Size" → custom_deal_size. */
export const customKeyFor = (header: string) => `custom_${normalizeHeader(header).replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "field"}`;

export type RowStatus = "ready" | "duplicate" | "skipped";
export interface ReviewRow { index: number; name: string; email: string | null; linkedinPath: string | null; company: string | null; custom: number; status: RowStatus; reason: string | null }

/**
 * Preview of what the import will do with each row: skipped when it lacks a name or any
 * contact handle (or has a malformed one), duplicate when an earlier row has the same
 * LinkedIn URL or email. The server re-validates and also dedupes against the workspace.
 */
export function reviewRows(rows: Array<Record<string, string>>, map: Record<string, string>, customHeaders: string[]): ReviewRow[] {
  const seen = new Set<string>();
  const cell = (r: Record<string, string>, field: string) => (map[field] ? (r[map[field]] ?? "").trim() : "") || null;
  return rows.map((r, index) => {
    const first = cell(r, "first_name"), last = cell(r, "last_name");
    const rawUrl = cell(r, "linkedin_url"), rawEmail = cell(r, "email");
    const url = rawUrl ? canonicalProfileUrl(rawUrl) : null;
    const email = rawEmail ? rawEmail.toLowerCase() : null;
    const base = {
      index, name: [first, last].filter(Boolean).join(" ") || "—", email,
      linkedinPath: url ? url.replace("https://www.linkedin.com", "") : rawUrl, company: cell(r, "company"),
      custom: customHeaders.filter((h) => (r[h] ?? "").trim()).length,
    };
    let reason: string | null = null;
    if (!first || !last) reason = "Missing first or last name";
    else if (rawUrl && !url) reason = "Not a linkedin.com/in/ URL";
    else if (email && !EMAIL_RE.test(email)) reason = "Invalid email";
    else if (!url && !email) reason = "Needs a LinkedIn URL or email";
    if (reason) return { ...base, status: "skipped" as const, reason };
    const keys = [url, email].filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k))) return { ...base, status: "duplicate" as const, reason: "Same contact earlier in the file" };
    keys.forEach((k) => seen.add(k));
    return { ...base, status: "ready" as const, reason: null };
  });
}
