import type Database from "better-sqlite3";
import { decryptSecret } from "@/lib/crypto";
import { matchPerson } from "@/lib/apollo";
import { verifyEmailAddress, emailStatusFor } from "@/lib/email/verify";

/**
 * Email waterfall: providers run in order and the first verified address wins. Each
 * provider is optional (it runs only when its API key is configured), results are cached
 * per person+provider, and the free pattern+SMTP probe runs last.
 */

export interface PersonQuery {
  firstName: string | null; lastName: string | null; fullName: string | null;
  company: string | null; domain: string | null; linkedinUrl: string | null;
}

export interface ProviderHit { email: string; verified: boolean; raw?: unknown }

export interface Provider {
  key: string;
  label: string;
  needsKey: boolean;
  find(q: PersonQuery, apiKey: string | null): Promise<ProviderHit | null>;
}

const json = async (res: Response) => { try { return await res.json(); } catch { return null; } };

export const PROVIDERS: Provider[] = [
  {
    key: "apollo", label: "Apollo", needsKey: true,
    async find(q, key) {
      if (!q.linkedinUrl || !key) return null;
      const m = await matchPerson(q.linkedinUrl, key);
      return m?.email ? { email: m.email, verified: m.email_status === "verified", raw: { status: m.email_status } } : null;
    },
  },
  {
    key: "hunter", label: "Hunter", needsKey: true,
    async find(q, key) {
      if (!q.domain || !q.firstName || !q.lastName || !key) return null;
      const u = new URL("https://api.hunter.io/v2/email-finder");
      u.search = new URLSearchParams({ domain: q.domain, first_name: q.firstName, last_name: q.lastName, api_key: key }).toString();
      const res = await fetch(u);
      const body = res.ok ? await json(res) as { data?: { email?: string; score?: number; verification?: { status?: string } } } | null : null;
      const email = body?.data?.email;
      return email ? { email, verified: body?.data?.verification?.status === "valid" || (body?.data?.score ?? 0) >= 90 } : null;
    },
  },
  {
    key: "prospeo", label: "Prospeo", needsKey: true,
    async find(q, key) {
      if (!q.firstName || !q.lastName || !(q.domain || q.company) || !key) return null;
      const res = await fetch("https://api.prospeo.io/email-finder", {
        method: "POST", headers: { "Content-Type": "application/json", "X-KEY": key },
        body: JSON.stringify({ first_name: q.firstName, last_name: q.lastName, company: q.domain || q.company }),
      });
      const body = res.ok ? await json(res) as { error?: boolean; response?: { email?: string | { email?: string; email_status?: string }; email_status?: string } } | null : null;
      if (!body || body.error) return null;
      const e = body.response?.email;
      const email = typeof e === "string" ? e : e?.email;
      const status = (typeof e === "object" ? e?.email_status : body.response?.email_status) ?? "";
      return email ? { email, verified: /valid/i.test(status) && !/invalid/i.test(status) } : null;
    },
  },
  {
    key: "findymail", label: "Findymail", needsKey: true,
    async find(q, key) {
      if (!q.fullName || !(q.domain || q.company) || !key) return null;
      const res = await fetch("https://app.findymail.com/api/search/name", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ name: q.fullName, domain: q.domain || q.company }),
      });
      const body = res.ok ? await json(res) as { contact?: { email?: string } } | null : null;
      // Findymail only returns addresses it has verified.
      return body?.contact?.email ? { email: body.contact.email, verified: true } : null;
    },
  },
  {
    key: "pattern", label: "Pattern + SMTP check", needsKey: false,
    async find(q) {
      const candidates = emailPatterns(q);
      for (const email of candidates.slice(0, 4)) {
        const r = await verifyEmailAddress(email, { timeoutMs: 8000 });
        if (r.status === "valid") return { email, verified: true };
        // A catch-all domain accepts every guess, so no guess can be trusted: stop probing.
        if (r.status === "catch_all") return null;
      }
      return null;
    },
  },
];

const clean = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

export function emailPatterns(q: Pick<PersonQuery, "firstName" | "lastName" | "domain">): string[] {
  const f = clean(q.firstName);
  const l = clean((q.lastName ?? "").trim().split(/\s+/).pop() ?? null);
  if (!f || !q.domain) return [];
  const d = q.domain.toLowerCase().replace(/^www\./, "");
  const out = l ? [`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`, `${l}.${f}`] : [f];
  return [...new Set(out)].map((local) => `${local}@${d}`);
}

export function domainFrom(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const host = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch { return null; }
}

export function providerOrder(db: Database.Database, workspaceId: string): string[] {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`enrichment_order:${workspaceId}`) as { value: string } | undefined;
  try {
    const order = row ? JSON.parse(row.value) as string[] : null;
    if (Array.isArray(order) && order.length) return order.filter((k) => PROVIDERS.some((p) => p.key === k));
  } catch { /* fall through */ }
  return PROVIDERS.map((p) => p.key);
}

export function setProviderOrder(db: Database.Database, workspaceId: string, order: string[]): void {
  const valid = order.filter((k) => PROVIDERS.some((p) => p.key === k));
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(`enrichment_order:${workspaceId}`, JSON.stringify(valid));
}

function apiKeyFor(db: Database.Database, workspaceId: string, key: string): string | null {
  const row = db.prepare("SELECT api_key FROM integrations WHERE key = ? AND workspace_id = ?").get(key, workspaceId) as { api_key: string | null } | undefined;
  return decryptSecret(row?.api_key ?? null);
}

export interface WaterfallResult { email: string; verified: boolean; provider: string }

/** Find an email for one contact and store it. Returns null when no provider found one. */
export async function enrichTargetEmail(db: Database.Database, workspaceId: string, targetId: string, providers: Provider[] = PROVIDERS): Promise<WaterfallResult | null> {
  const t = db.prepare(`SELECT t.first_name, t.last_name, t.full_name, t.company, t.linkedin_url, t.email, c.domain, c.website
    FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ? AND t.workspace_id = ?`).get(targetId, workspaceId) as
    { first_name: string | null; last_name: string | null; full_name: string | null; company: string | null; linkedin_url: string | null; email: string | null; domain: string | null; website: string | null } | undefined;
  if (!t || t.email) return null;
  const q: PersonQuery = { firstName: t.first_name, lastName: t.last_name, fullName: t.full_name, company: t.company, domain: domainFrom(t.domain) ?? domainFrom(t.website), linkedinUrl: t.linkedin_url };
  const identity = t.linkedin_url?.toLowerCase() ?? `${clean(t.full_name)}@${q.domain ?? clean(t.company)}`;

  for (const key of providerOrder(db, workspaceId)) {
    const provider = providers.find((p) => p.key === key);
    if (!provider) continue;
    const apiKey = provider.needsKey ? apiKeyFor(db, workspaceId, key) : null;
    if (provider.needsKey && !apiKey) continue;
    const cached = db.prepare("SELECT email, verified FROM enrichment_cache WHERE identity_key = ? AND provider = ? AND fetched_at > datetime('now', '-30 days')").get(identity, key) as { email: string | null; verified: number } | undefined;
    let hit: ProviderHit | null;
    if (cached) hit = cached.email ? { email: cached.email, verified: !!cached.verified } : null;
    else {
      try { hit = await provider.find(q, apiKey); } catch { hit = null; }
      db.prepare(`INSERT INTO enrichment_cache (identity_key, provider, email, verified, result_json, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(identity_key, provider) DO UPDATE SET email = excluded.email, verified = excluded.verified, result_json = excluded.result_json, fetched_at = excluded.fetched_at`)
        .run(identity, key, hit?.email ?? null, hit?.verified ? 1 : 0, hit?.raw ? JSON.stringify(hit.raw) : null);
    }
    if (hit?.email) {
      const status = hit.verified ? emailStatusFor("valid") : "unverified";
      db.prepare("UPDATE targets SET email = ?, email_status = ?, email_verified_at = CASE WHEN ? THEN datetime('now') ELSE email_verified_at END WHERE id = ? AND email IS NULL")
        .run(hit.email.toLowerCase(), status, hit.verified ? 1 : 0, targetId);
      return { email: hit.email.toLowerCase(), verified: hit.verified, provider: key };
    }
  }
  return null;
}
