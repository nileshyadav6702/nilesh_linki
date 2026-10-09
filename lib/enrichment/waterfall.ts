import type Database from "better-sqlite3";
import { decryptSecret } from "@/lib/crypto";
import { matchPerson, ApolloError } from "@/lib/apollo";
import { verifyEmailAddress, emailStatusFor } from "@/lib/email/verify";

/**
 * Email waterfall: providers run in order and the first verified address wins. Each
 * provider is optional (it runs only when its API key is configured), genuine results
 * (hit or miss) are cached per person+provider, provider errors are never cached, and the
 * free pattern+SMTP probe runs last. An unverified hit is kept as a fallback while later
 * providers are tried for a verified one.
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

/**
 * A provider failed (rate limit, credits, auth, 5xx, network). Distinct from "not found"
 * (null): errors are never cached, and the waterfall moves on to the next provider.
 */
export class ProviderError extends Error {
  constructor(public provider: string, message: string, public status: number | null = null) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

const json = async (res: Response) => { try { return await res.json(); } catch { return null; } };
const TIMEOUT_MS = 20_000;

/** Body of a provider response, null for a 404 (no match), ProviderError for any other failure. */
async function bodyOrThrow<T>(provider: string, res: Response, notFound?: (body: T | null) => boolean): Promise<T | null> {
  const body = await json(res) as T | null;
  if (res.status === 404 || (notFound && notFound(body))) return null;
  if (!res.ok) throw new ProviderError(provider, `request failed (${res.status})`, res.status);
  if (body === null) throw new ProviderError(provider, "unreadable response", res.status);
  return body;
}

type ProspeoBody = { error?: boolean; message?: string; response?: { email?: string | { email?: string; email_status?: string }; email_status?: string } };
const prospeoNoResult = (b: ProspeoBody | null) => !!b?.error && /NO_RESULT|NO_MATCH|not.?found/i.test(b.message ?? "");

export const PROVIDERS: Provider[] = [
  {
    // treg.to routed email finder (cheapest provider first, verified in the same call). Key: TREG_API_KEY.
    key: "treg", label: "Treg", needsKey: true,
    async find(q) {
      if (!q.domain && !q.linkedinUrl) return null;
      const { tregCall, TregError } = await import("@/lib/treg/client");
      const body: Record<string, string> = {};
      if (q.domain) body.domain = q.domain;
      if (q.firstName) body.first_name = q.firstName;
      if (q.lastName) body.last_name = q.lastName;
      if (q.fullName) body.full_name = q.fullName;
      if (q.linkedinUrl) body.linkedin_url = q.linkedinUrl;
      try {
        const r = await tregCall<{ output?: { email?: string | null; confidence?: number }; _treg?: { verification?: { verdict?: string } } }>("treg.people.email.find", {
          workspaceId: null, purpose: "email_find", body, maxCostUsd: 0.03, headers: { "X-Treg-Route-Verify": "true" },
        });
        const email = r.data?.output?.email;
        if (!email) return null;
        const verdict = (r.data?._treg?.verification?.verdict ?? "").toLowerCase();
        return { email, verified: /^(valid|deliverable|ok|safe)$/.test(verdict) || (r.data?.output?.confidence ?? 0) >= 0.9, raw: { verdict, served_by: r.servedBy } };
      } catch (err) {
        if (err instanceof TregError && err.status === 404) return null;
        throw new ProviderError("treg", err instanceof Error ? err.message : String(err), err instanceof TregError ? err.status : null);
      }
    },
  },
  {
    key: "apollo", label: "Apollo", needsKey: true,
    async find(q, key) {
      if (!q.linkedinUrl || !key) return null;
      let m;
      try { m = await matchPerson(q.linkedinUrl, key); } catch (err) {
        throw new ProviderError("apollo", err instanceof Error ? err.message : String(err), err instanceof ApolloError ? err.status : null);
      }
      return m?.email ? { email: m.email, verified: m.email_status === "verified", raw: { status: m.email_status } } : null;
    },
  },
  {
    key: "hunter", label: "Hunter", needsKey: true,
    async find(q, key) {
      if (!q.domain || !q.firstName || !q.lastName || !key) return null;
      const u = new URL("https://api.hunter.io/v2/email-finder");
      u.search = new URLSearchParams({ domain: q.domain, first_name: q.firstName, last_name: q.lastName, api_key: key }).toString();
      const res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await bodyOrThrow<{ data?: { email?: string; score?: number; verification?: { status?: string } } }>("hunter", res);
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await bodyOrThrow<ProspeoBody>("prospeo", res, prospeoNoResult);
      if (!body) return null;
      if (body.error) throw new ProviderError("prospeo", body.message || "error response", res.status);
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await bodyOrThrow<{ contact?: { email?: string } | null }>("findymail", res);
      // Findymail only returns addresses it has verified.
      return body?.contact?.email ? { email: body.contact.email, verified: true } : null;
    },
  },
  {
    key: "pattern", label: "Pattern + SMTP check", needsKey: false,
    async find(q) {
      const candidates = emailPatterns(q).slice(0, 4);
      let inconclusive = 0;
      for (const email of candidates) {
        const r = await verifyEmailAddress(email, { timeoutMs: 8000 });
        if (r.status === "valid") return { email, verified: true };
        // A catch-all domain accepts every guess, so no guess can be trusted: stop probing.
        if (r.status === "catch_all") return null;
        if (r.status === "unknown") inconclusive++;
      }
      // Every probe was inconclusive (DNS/SMTP unreachable): an error, not a miss, so it is not cached.
      if (candidates.length && inconclusive === candidates.length) throw new ProviderError("pattern", "mail server unreachable");
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
  if (key === "treg") return process.env.TREG_API_KEY?.trim() || null;
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

  const store = (r: WaterfallResult): WaterfallResult => {
    const status = r.verified ? emailStatusFor("valid") : "unverified";
    db.prepare("UPDATE targets SET email = ?, email_status = ?, email_verified_at = CASE WHEN ? THEN datetime('now') ELSE email_verified_at END WHERE id = ? AND email IS NULL")
      .run(r.email, status, r.verified ? 1 : 0, targetId);
    return r;
  };

  // First unverified hit, used only when no later provider finds a verified address.
  let fallback: WaterfallResult | null = null;
  for (const key of providerOrder(db, workspaceId)) {
    const provider = providers.find((p) => p.key === key);
    if (!provider) continue;
    const apiKey = provider.needsKey ? apiKeyFor(db, workspaceId, key) : null;
    if (provider.needsKey && !apiKey) continue;
    const cached = db.prepare("SELECT email, verified FROM enrichment_cache WHERE identity_key = ? AND provider = ? AND fetched_at > datetime('now', '-30 days')").get(identity, key) as { email: string | null; verified: number } | undefined;
    let hit: ProviderHit | null;
    if (cached) hit = cached.email ? { email: cached.email, verified: !!cached.verified } : null;
    else {
      try { hit = await provider.find(q, apiKey); } catch (err) {
        // Rate limit, credits, outage: not a miss. Don't cache it; try the next provider.
        console.warn(`[enrichment] ${key} failed for ${targetId}:`, err instanceof Error ? err.message : err);
        continue;
      }
      db.prepare(`INSERT INTO enrichment_cache (identity_key, provider, email, verified, result_json, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(identity_key, provider) DO UPDATE SET email = excluded.email, verified = excluded.verified, result_json = excluded.result_json, fetched_at = excluded.fetched_at`)
        .run(identity, key, hit?.email ?? null, hit?.verified ? 1 : 0, hit?.raw ? JSON.stringify(hit.raw) : null);
    }
    if (!hit?.email) continue;
    const r: WaterfallResult = { email: hit.email.toLowerCase(), verified: hit.verified, provider: key };
    if (r.verified) return store(r);
    fallback ??= r;
  }
  return fallback ? store(fallback) : null;
}
