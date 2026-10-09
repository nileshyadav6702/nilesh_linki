import { createHash } from "crypto";
import { call, IntegrationError, replyNote, splitName, type Adapter, type Config, type Lead } from "@/lib/integrations/types";

/**
 * OAuth CRMs (the customer's own Zoho / Salesforce app). Refresh tokens are stored encrypted with
 * the connection; access tokens are cached in memory until shortly before they expire. Every host
 * that receives a token is checked against the provider's domains.
 */

export interface OAuthAdapter extends Adapter {
  authorizeUrl(cfg: Config, redirectUri: string, state: string, challenge: string): string;
  /** Code → tokens. Returns the config fields to store (refresh token, API host…). */
  exchange(cfg: Config, code: string, redirectUri: string, verifier: string, query: Record<string, string>): Promise<Config>;
}

const tokens = new Map<string, { token: string; until: number }>();
const cacheKey = (app: string, refresh: string) => `${app}:${createHash("sha256").update(refresh).digest("hex")}`;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

function hostOk(url: string, suffixes: string[]): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new IntegrationError("Invalid API address", true); }
  if (u.protocol !== "https:" || !suffixes.some((s) => u.hostname === s.replace(/^\./, "") || u.hostname.endsWith(s))) throw new IntegrationError(`Unexpected API address ${u.hostname}`, true);
  return u.origin;
}

// ── Zoho CRM ───────────────────────────────────────────────────────────────────
const ZOHO_ACCOUNTS: Record<string, string> = {
  com: "accounts.zoho.com", eu: "accounts.zoho.eu", in: "accounts.zoho.in", "com.au": "accounts.zoho.com.au",
  jp: "accounts.zoho.jp", "com.cn": "accounts.zoho.com.cn", ca: "accounts.zohocloud.ca", sa: "accounts.zoho.sa",
};
const ZOHO_ACCOUNT_HOSTS = Object.values(ZOHO_ACCOUNTS).map((h) => `.${h.replace(/^accounts\./, "")}`).concat(Object.values(ZOHO_ACCOUNTS));
const ZOHO_API_HOSTS = [".zohoapis.com", ".zohoapis.eu", ".zohoapis.in", ".zohoapis.com.au", ".zohoapis.jp", ".zohoapis.com.cn", ".zohoapis.ca", ".zohoapis.sa"];

const zohoAccounts = (cfg: Config) => {
  const host = cfg.accounts_server ? hostOk(cfg.accounts_server, ZOHO_ACCOUNT_HOSTS) : `https://${ZOHO_ACCOUNTS[cfg.region ?? ""] ?? ""}`;
  if (host === "https://") throw new IntegrationError("Choose your Zoho data center region", true);
  return host;
};

async function zohoToken(cfg: Config): Promise<string> {
  if (!cfg.refresh_token) throw new IntegrationError("Zoho isn't authorized yet. Reconnect it.", true, 401);
  const key = cacheKey("zoho", cfg.refresh_token);
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const r = await call<{ access_token?: string; expires_in?: number; error?: string }>("Zoho", `${zohoAccounts(cfg)}/oauth/v2/token`, {
    method: "POST", headers: FORM, body: form({ grant_type: "refresh_token", refresh_token: cfg.refresh_token, client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "" }),
  });
  if (!r.access_token) throw new IntegrationError(`Zoho refused to refresh access (${r.error ?? "unknown error"}). Reconnect it.`, true, 401);
  tokens.set(key, { token: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000 });
  return r.access_token;
}
const zohoApi = (cfg: Config) => hostOk(cfg.api_domain ?? "", ZOHO_API_HOSTS);
const zohoAuth = async (cfg: Config) => ({ Authorization: `Zoho-oauthtoken ${await zohoToken(cfg)}` });

export const zoho: OAuthAdapter = {
  authorizeUrl(cfg, redirectUri, state) {
    return `${zohoAccounts(cfg)}/oauth/v2/auth?${form({ scope: "ZohoCRM.modules.ALL,ZohoCRM.users.READ", client_id: cfg.client_id ?? "", response_type: "code", access_type: "offline", prompt: "consent", redirect_uri: redirectUri, state })}`;
  },
  async exchange(cfg, code, redirectUri, _verifier, query) {
    // Zoho answers on the account's own data center, which the callback names.
    const accounts = query["accounts-server"] ? hostOk(query["accounts-server"], ZOHO_ACCOUNT_HOSTS) : zohoAccounts(cfg);
    const r = await call<{ access_token?: string; refresh_token?: string; api_domain?: string; expires_in?: number; error?: string }>("Zoho", `${accounts}/oauth/v2/token`, {
      method: "POST", headers: FORM, body: form({ grant_type: "authorization_code", client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "", redirect_uri: redirectUri, code }),
    });
    if (!r.refresh_token || !r.api_domain) throw new IntegrationError(`Zoho didn't grant offline access (${r.error ?? "no refresh token"})`, true);
    hostOk(r.api_domain, ZOHO_API_HOSTS);
    if (r.access_token) tokens.set(cacheKey("zoho", r.refresh_token), { token: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000 });
    return { refresh_token: r.refresh_token, api_domain: r.api_domain, accounts_server: accounts };
  },
  async verify(cfg) {
    const r = await call<{ users?: Array<{ full_name?: string; email?: string }> }>("Zoho", `${zohoApi(cfg)}/crm/v8/users?type=CurrentUser`, { headers: await zohoAuth(cfg) });
    return { account: r.users?.[0]?.full_name ?? r.users?.[0]?.email };
  },
  async pushContact(cfg, l) {
    const { first, last } = splitName(l);
    const record: Record<string, unknown> = { First_Name: first, Last_Name: last || first || "Unknown", Company: l.company || "Unknown", Lead_Source: "Kairo" };
    if (l.email) record.Email = l.email;
    if (l.title) record.Designation = l.title;
    if (l.company_domain) record.Website = l.company_domain;
    if (l.phone) record.Phone = l.phone;
    if (l.linkedin_url) record.Description = `LinkedIn: ${l.linkedin_url}`;
    const r = await call<{ data?: Array<{ status?: string; message?: string; details?: { id?: string } }> }>("Zoho", `${zohoApi(cfg)}/crm/v8/Leads/upsert`, {
      method: "POST", headers: await zohoAuth(cfg), json: { data: [record], ...(l.email ? { duplicate_check_fields: ["Email"] } : {}) },
    });
    const row = r.data?.[0];
    if (row?.status === "error") throw new IntegrationError(`Zoho: ${row.message ?? "record rejected"}`, true);
    return row?.details?.id ?? null;
  },
};

// ── Salesforce ─────────────────────────────────────────────────────────────────
const SF_HOSTS = [".salesforce.com", ".force.com", ".salesforce.mil", ".cloudforce.com"];
const SF_VERSION = "v60.0";
const sfLogin = (cfg: Config) => hostOk(cfg.instance_url || "https://login.salesforce.com", SF_HOSTS);

async function sfToken(cfg: Config): Promise<string> {
  if (!cfg.refresh_token) throw new IntegrationError("Salesforce isn't authorized yet. Reconnect it.", true, 401);
  const key = cacheKey("salesforce", cfg.refresh_token);
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const r = await call<{ access_token?: string }>("Salesforce", `${sfLogin(cfg)}/services/oauth2/token`, {
    method: "POST", headers: FORM, body: form({ grant_type: "refresh_token", refresh_token: cfg.refresh_token, client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "" }),
  });
  if (!r.access_token) throw new IntegrationError("Salesforce refused to refresh access. Reconnect it.", true, 401);
  // Salesforce doesn't return a lifetime on refresh; sessions last at least 15 minutes.
  tokens.set(key, { token: r.access_token, until: Date.now() + 10 * 60_000 });
  return r.access_token;
}
const sfApi = (cfg: Config) => hostOk(cfg.api_instance ?? "", SF_HOSTS);
const sfAuth = async (cfg: Config) => ({ Authorization: `Bearer ${await sfToken(cfg)}` });
const soqlString = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function sfFindLead(cfg: Config, email: string): Promise<string | null> {
  const q = `SELECT Id FROM Lead WHERE Email = '${soqlString(email)}' ORDER BY CreatedDate DESC LIMIT 1`;
  const r = await call<{ records?: Array<{ Id: string }> }>("Salesforce", `${sfApi(cfg)}/services/data/${SF_VERSION}/query?q=${encodeURIComponent(q)}`, { headers: await sfAuth(cfg) });
  return r.records?.[0]?.Id ?? null;
}
async function sfCreateLead(cfg: Config, l: Lead): Promise<string> {
  const { first, last } = splitName(l);
  const body: Record<string, unknown> = { FirstName: first, LastName: last || first || "Unknown", Company: l.company || "Unknown", LeadSource: "Kairo" };
  if (l.email) body.Email = l.email;
  if (l.title) body.Title = l.title;
  if (l.company_domain) body.Website = l.company_domain;
  if (l.phone) body.Phone = l.phone;
  if (l.linkedin_url) body.Description = `LinkedIn: ${l.linkedin_url}`;
  const r = await call<{ id: string }>("Salesforce", `${sfApi(cfg)}/services/data/${SF_VERSION}/sobjects/Lead`, { method: "POST", headers: await sfAuth(cfg), json: body });
  return r.id;
}

export const salesforce: OAuthAdapter = {
  authorizeUrl(cfg, redirectUri, state, challenge) {
    return `${sfLogin(cfg)}/services/oauth2/authorize?${form({ response_type: "code", client_id: cfg.client_id ?? "", redirect_uri: redirectUri, scope: "api refresh_token", state, code_challenge: challenge, code_challenge_method: "S256" })}`;
  },
  async exchange(cfg, code, redirectUri, verifier) {
    const r = await call<{ access_token?: string; refresh_token?: string; instance_url?: string }>("Salesforce", `${sfLogin(cfg)}/services/oauth2/token`, {
      method: "POST", headers: FORM, body: form({ grant_type: "authorization_code", code, client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "", redirect_uri: redirectUri, code_verifier: verifier }),
    });
    if (!r.refresh_token || !r.instance_url) throw new IntegrationError("Salesforce didn't grant offline access. Add the refresh_token scope to the Connected App.", true);
    const api = hostOk(r.instance_url, SF_HOSTS);
    if (r.access_token) tokens.set(cacheKey("salesforce", r.refresh_token), { token: r.access_token, until: Date.now() + 10 * 60_000 });
    return { refresh_token: r.refresh_token, api_instance: api };
  },
  async verify(cfg) {
    const r = await call<{ name?: string; email?: string }>("Salesforce", `${sfApi(cfg)}/services/oauth2/userinfo`, { headers: await sfAuth(cfg) });
    return { account: r.name ?? r.email };
  },
  async pushContact(cfg, l) {
    const existing = l.email ? await sfFindLead(cfg, l.email) : null;
    return existing ?? sfCreateLead(cfg, l);
  },
  async addReply(cfg, l, reply, { create }) {
    let id = l.email ? await sfFindLead(cfg, l.email) : null;
    if (!id) { if (!create) throw new IntegrationError("This lead isn't in Salesforce yet", true); id = await sfCreateLead(cfg, l); }
    const r = await call<{ id: string }>("Salesforce", `${sfApi(cfg)}/services/data/${SF_VERSION}/sobjects/Task`, {
      method: "POST", headers: await sfAuth(cfg),
      json: { WhoId: id, Subject: `${reply.channel === "linkedin" ? "LinkedIn" : "Email"} reply`, Description: replyNote(l, reply).slice(0, 31_000), Status: "Completed", ActivityDate: reply.received_at.slice(0, 10) },
    });
    return r.id;
  },
};
