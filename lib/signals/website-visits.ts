import { createHash, randomBytes, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { decryptSecret } from "@/lib/crypto";
import { ingestSignal } from "@/lib/platform/signals";
import { isPrivateAddress } from "@/lib/icp/site";

/**
 * Website-visitor signals. A tiny pixel on the customer's site reports page views; the
 * visitor IP is resolved to a company with IPinfo (optional key 'ipinfo'), then the visit
 * becomes a company-level signal that fans out to known contacts there. The raw IP is
 * never stored — only a salted hash, for counting repeat visits.
 */

export function pixelToken(db: Database.Database, workspaceId: string): string {
  const row = db.prepare("SELECT token FROM site_pixels WHERE workspace_id = ?").get(workspaceId) as { token: string } | undefined;
  if (row) return row.token;
  const token = randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO site_pixels (workspace_id, token) VALUES (?, ?)").run(workspaceId, token);
  return token;
}

export function pixelSnippet(origin: string, token: string): string {
  return `<script>(function(){var i=new Image();i.src="${origin}/api/t/v/${token}?u="+encodeURIComponent(location.href)+"&r="+encodeURIComponent(document.referrer)+"&t="+Date.now();})();</script>`;
}

export function workspaceForToken(db: Database.Database, token: string): string | null {
  return (db.prepare("SELECT workspace_id FROM site_pixels WHERE token = ?").get(token) as { workspace_id: string } | undefined)?.workspace_id ?? null;
}

interface IpCompany { name: string; domain: string | null }

export async function lookupIpCompany(ip: string, token: string): Promise<IpCompany | null> {
  const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const j = await res.json() as { company?: { name?: string; domain?: string; type?: string }; org?: string };
  // Only business ranges; ISPs/hosting are not a company visiting.
  if (j.company?.name && (j.company.type === "business" || !j.company.type)) return { name: j.company.name, domain: j.company.domain ?? null };
  return null;
}

export async function recordVisit(db: Database.Database, workspaceId: string, input: { ip: string; pageUrl: string | null; referrer: string | null }): Promise<void> {
  const salt = process.env.NEXTAUTH_SECRET ?? "linki";
  const ipHash = createHash("sha256").update(`${salt}:${input.ip}`).digest("hex").slice(0, 32);
  let company: IpCompany | null = null;
  const keyRow = db.prepare("SELECT api_key FROM integrations WHERE key = 'ipinfo' AND workspace_id = ?").get(workspaceId) as { api_key: string | null } | undefined;
  const key = decryptSecret(keyRow?.api_key ?? null);
  if (key && input.ip && !isPrivateAddress(input.ip)) {
    try { company = await lookupIpCompany(input.ip, key); } catch { company = null; }
  }
  db.prepare("INSERT INTO website_visits (id, workspace_id, page_url, referrer, company_domain, company_name, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), workspaceId, input.pageUrl?.slice(0, 500) ?? null, input.referrer?.slice(0, 500) ?? null, company?.domain ?? null, company?.name ?? null, ipHash);
  if (!company) return;

  let companyId = (db.prepare("SELECT id FROM companies WHERE workspace_id = ? AND (lower(name) = lower(?) OR (? IS NOT NULL AND domain = ?))").get(workspaceId, company.name, company.domain, company.domain) as { id: string } | undefined)?.id;
  if (!companyId) {
    companyId = randomUUID();
    db.prepare("INSERT INTO companies (id, workspace_id, name, domain) VALUES (?, ?, ?, ?)").run(companyId, workspaceId, company.name, company.domain);
  }
  const day = new Date().toISOString().slice(0, 10);
  const path = (() => { try { return input.pageUrl ? new URL(input.pageUrl).pathname : null; } catch { return null; } })();
  const signal = { workspaceId, type: "website_visit", title: `${company.name} visited your website${path && path !== "/" ? ` (${path})` : ""}`, source: "site_pixel", sourceUrl: input.pageUrl ?? undefined };
  ingestSignal({ ...signal, companyId, dedupeKey: `visit:${companyId}:${day}` });
  const people = db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND (company_id = ? OR lower(company) = lower(?)) LIMIT 25").all(workspaceId, companyId, company.name) as Array<{ id: string }>;
  for (const p of people) ingestSignal({ ...signal, targetId: p.id, companyId, dedupeKey: `visit:${companyId}:${day}:t:${p.id}` });
}
