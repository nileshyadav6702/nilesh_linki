import { call, IntegrationError, splitName, type Adapter, type Config } from "@/lib/integrations/types";

/** Outreach tools: each lead is added to the campaign (or list) picked when connecting. */

const need = (cfg: Config, k: string, what: string) => { const v = cfg[k]; if (!v) throw new IntegrationError(`${what} is missing`, true); return v; };

// ── Instantly (API v2) ─────────────────────────────────────────────────────────
const IN = "https://api.instantly.ai/api/v2";
const inAuth = (cfg: Config) => ({ Authorization: `Bearer ${need(cfg, "api_key", "The API key")}` });

export const instantly: Adapter = {
  async verify(cfg) {
    const r = await call<{ name?: string }>("Instantly", `${IN}/workspaces/current`, { headers: inAuth(cfg) });
    return { account: r?.name };
  },
  async choices(cfg) {
    const out: Array<{ value: string; label: string }> = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await call<{ items?: Array<{ id: string; name: string }>; next_starting_after?: string }>("Instantly", `${IN}/campaigns?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`, { headers: inAuth(cfg) });
      out.push(...(r.items ?? []).map((c) => ({ value: c.id, label: c.name })));
      if (!r.next_starting_after) break;
      after = r.next_starting_after;
    }
    return out;
  },
  async pushContact(cfg, l, { verify }) {
    if (!l.email) throw new IntegrationError("Instantly needs an email address", true);
    const { first, last } = splitName(l);
    const lead: Record<string, unknown> = { email: l.email, first_name: first, last_name: last };
    if (l.company) lead.company_name = l.company;
    if (l.title) lead.job_title = l.title;
    if (l.company_domain) lead.website = l.company_domain;
    if (l.phone) lead.phone = l.phone;
    if (l.linkedin_url) lead.custom_variables = { linkedin_url: l.linkedin_url };
    await call("Instantly", `${IN}/leads/add`, {
      method: "POST", headers: inAuth(cfg),
      json: { campaign_id: need(cfg, "choice", "The campaign"), leads: [lead], verify_leads_on_import: !!verify, skip_if_in_campaign: true },
    });
    return null;
  },
};

// ── Smartlead ──────────────────────────────────────────────────────────────────
const SL = "https://server.smartlead.ai/api/v1";
const sl = (cfg: Config, path: string) => `${SL}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(need(cfg, "api_key", "The API key"))}`;

export const smartlead: Adapter = {
  async verify(cfg) { await call("Smartlead", sl(cfg, "/campaigns/")); return {}; },
  async choices(cfg) {
    const r = await call<Array<{ id: number; name: string }>>("Smartlead", sl(cfg, "/campaigns/"));
    return (Array.isArray(r) ? r : []).map((c) => ({ value: String(c.id), label: c.name }));
  },
  async pushContact(cfg, l) {
    if (!l.email) throw new IntegrationError("Smartlead needs an email address", true);
    const { first, last } = splitName(l);
    const lead: Record<string, unknown> = { email: l.email, first_name: first, last_name: last };
    if (l.company) lead.company_name = l.company;
    if (l.phone) lead.phone_number = l.phone;
    if (l.company_domain) lead.website = l.company_domain;
    if (l.location) lead.location = l.location;
    if (l.linkedin_url) lead.linkedin_profile = l.linkedin_url;
    if (l.title) lead.custom_fields = { job_title: l.title };
    await call("Smartlead", sl(cfg, `/campaigns/${encodeURIComponent(need(cfg, "choice", "The campaign"))}/leads`), { method: "POST", json: { lead_list: [lead] } });
    return null;
  },
};

// ── SmartReach (API v3, team-scoped) ───────────────────────────────────────────
const SR = "https://api.smartreach.io/api/v3";
const srAuth = (cfg: Config) => ({ "X-API-KEY": need(cfg, "api_key", "The API key") });
const sr = (cfg: Config, path: string) => `${SR}${path}${path.includes("?") ? "&" : "?"}team_id=${encodeURIComponent(need(cfg, "team_id", "The Team ID"))}`;

export const smartreach: Adapter = {
  async verify(cfg) { await call("SmartReach", sr(cfg, "/users"), { headers: srAuth(cfg) }); return {}; },
  async pushContact(cfg, l) {
    if (!l.email) throw new IntegrationError("SmartReach needs an email address", true);
    const { first, last } = splitName(l);
    const p: Record<string, unknown> = { email: l.email, first_name: first, last_name: last };
    if (l.company) p.company = l.company;
    if (l.linkedin_url) p.linkedin_url = l.linkedin_url;
    if (l.phone) p.phone_number = l.phone;
    if (l.title) p.custom_fields = { job_title: l.title };
    const r = await call<unknown>("SmartReach", sr(cfg, "/prospects"), { method: "POST", headers: srAuth(cfg), json: [p] });
    // The response shape isn't documented consistently: find the created prospect id wherever it is.
    const found = JSON.stringify(r ?? {}).match(/"(?:prospect_)?id"\s*:\s*"?([\w-]+)"?/);
    const id = found?.[1];
    if (!id) throw new IntegrationError("SmartReach didn't return the prospect id", true);
    await call("SmartReach", sr(cfg, `/campaigns/${encodeURIComponent(need(cfg, "campaign_id", "The Campaign ID"))}/prospects`), { method: "POST", headers: srAuth(cfg), json: { prospect_ids: [id] } });
    return id;
  },
};

// ── HeyReach (public API) ──────────────────────────────────────────────────────
const HR = "https://api.heyreach.io/api/public";
const hrAuth = (cfg: Config) => ({ "X-API-KEY": need(cfg, "api_key", "The API key") });

export const heyreach: Adapter = {
  async verify(cfg) { await call("HeyReach", `${HR}/auth/CheckApiKey`, { headers: hrAuth(cfg) }); return {}; },
  async choices(cfg) {
    const r = await call<{ items?: Array<{ id: number; name: string }> }>("HeyReach", `${HR}/list/GetAll`, { method: "POST", headers: hrAuth(cfg), json: { offset: 0, limit: 100, listType: "USER_LIST" } });
    return (r.items ?? []).map((x) => ({ value: String(x.id), label: x.name }));
  },
  async pushContact(cfg, l) {
    if (!l.linkedin_url) throw new IntegrationError("HeyReach needs the lead's LinkedIn profile URL", true);
    const { first, last } = splitName(l);
    const lead: Record<string, unknown> = { firstName: first, lastName: last, profileUrl: l.linkedin_url };
    if (l.company) lead.companyName = l.company;
    if (l.title) lead.position = l.title;
    if (l.email) lead.emailAddress = l.email;
    if (l.location) lead.location = l.location;
    await call("HeyReach", `${HR}/list/AddLeadsToListV2`, { method: "POST", headers: hrAuth(cfg), json: { listId: Number(need(cfg, "choice", "The list")), leads: [lead] } });
    return null;
  },
};
