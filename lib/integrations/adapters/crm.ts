import { call, IntegrationError, isoOf, replyNote, splitName, type Adapter, type Config, type Lead } from "@/lib/integrations/types";

/** API-key CRMs: HubSpot, Pipedrive, Attio, Folk, Breakcold. */

const need = (cfg: Config, k = "api_key") => { const v = cfg[k]; if (!v) throw new IntegrationError("The API key is missing", true); return v; };
const noRecord = (app: string) => new IntegrationError(`This lead isn't in ${app} yet (turn on "Create the contact on reply" or "Automatically send new contacts")`, true);

// ── HubSpot (private app token, CRM v3) ────────────────────────────────────────
const HS = "https://api.hubapi.com";
const hsAuth = (cfg: Config) => ({ Authorization: `Bearer ${need(cfg)}` });
const hsProps = (l: Lead) => {
  const { first, last } = splitName(l);
  const p: Record<string, string> = { firstname: first, lastname: last };
  if (l.email) p.email = l.email;
  if (l.title) p.jobtitle = l.title;
  if (l.company) p.company = l.company;
  if (l.company_domain) p.website = l.company_domain;
  if (l.phone) p.phone = l.phone;
  return p;
};

async function hsFind(cfg: Config, email: string): Promise<string | null> {
  try {
    const r = await call<{ id: string }>("HubSpot", `${HS}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`, { headers: hsAuth(cfg) });
    return r.id;
  } catch (err) {
    if (err instanceof IntegrationError && err.status === 404) return null;
    throw err;
  }
}

export const hubspot: Adapter = {
  async verify(cfg) {
    const r = await call<{ portalId?: number; uiDomain?: string }>("HubSpot", `${HS}/account-info/v3/details`, { headers: hsAuth(cfg) });
    return { account: r.portalId ? `Portal ${r.portalId}` : undefined };
  },
  async pushContact(cfg, l) {
    if (l.email) {
      const r = await call<{ results: Array<{ id: string }> }>("HubSpot", `${HS}/crm/v3/objects/contacts/batch/upsert`, {
        method: "POST", headers: hsAuth(cfg), json: { inputs: [{ idProperty: "email", id: l.email, properties: hsProps(l) }] },
      });
      return r.results?.[0]?.id ?? null;
    }
    const r = await call<{ id: string }>("HubSpot", `${HS}/crm/v3/objects/contacts`, { method: "POST", headers: hsAuth(cfg), json: { properties: hsProps(l) } });
    return r.id;
  },
  async addReply(cfg, l, reply, { create }) {
    let id = l.email ? await hsFind(cfg, l.email) : null;
    if (!id) { if (!create) throw noRecord("HubSpot"); id = await hubspot.pushContact(cfg, l, {}); }
    if (!id) throw new IntegrationError("HubSpot didn't return the contact", true);
    const r = await call<{ id: string }>("HubSpot", `${HS}/crm/v3/objects/notes`, {
      method: "POST", headers: hsAuth(cfg),
      json: { properties: { hs_timestamp: isoOf(reply.received_at), hs_note_body: replyNote(l, reply).replace(/\n/g, "<br>") },
        associations: [{ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] },
    });
    return r.id;
  },
};

// ── Pipedrive (api_token, v1) ──────────────────────────────────────────────────
const PD = "https://api.pipedrive.com/v1";
const pd = (cfg: Config, path: string) => `${PD}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(need(cfg))}`;

async function pdFind(cfg: Config, email: string): Promise<number | null> {
  const r = await call<{ data?: { items?: Array<{ item: { id: number } }> } }>("Pipedrive", pd(cfg, `/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=true&limit=1`));
  return r.data?.items?.[0]?.item.id ?? null;
}
async function pdOrg(cfg: Config, name: string): Promise<number> {
  const found = await call<{ data?: { items?: Array<{ item: { id: number } }> } }>("Pipedrive", pd(cfg, `/organizations/search?term=${encodeURIComponent(name)}&exact_match=true&limit=1`));
  const id = found.data?.items?.[0]?.item.id;
  if (id) return id;
  return (await call<{ data: { id: number } }>("Pipedrive", pd(cfg, "/organizations"), { method: "POST", json: { name } })).data.id;
}

export const pipedrive: Adapter = {
  async verify(cfg) {
    const r = await call<{ data?: { name?: string; company_name?: string } }>("Pipedrive", pd(cfg, "/users/me"));
    return { account: r.data?.company_name ?? r.data?.name };
  },
  async pushContact(cfg, l) {
    const existing = l.email ? await pdFind(cfg, l.email) : null;
    if (existing) return String(existing);
    const body: Record<string, unknown> = { name: l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || "Unknown" };
    if (l.email) body.email = [{ value: l.email, primary: true, label: "work" }];
    if (l.phone) body.phone = [{ value: l.phone, primary: true, label: "work" }];
    if (l.company) body.org_id = await pdOrg(cfg, l.company);
    const r = await call<{ data: { id: number } }>("Pipedrive", pd(cfg, "/persons"), { method: "POST", json: body });
    if (l.title || l.linkedin_url) await call("Pipedrive", pd(cfg, "/notes"), { method: "POST", json: { person_id: r.data.id, content: [l.title && `Title: ${l.title}`, l.linkedin_url && `LinkedIn: ${l.linkedin_url}`].filter(Boolean).join("<br>") } });
    return String(r.data.id);
  },
  async addReply(cfg, l, reply, { create }) {
    let id = l.email ? await pdFind(cfg, l.email) : null;
    if (!id) { if (!create) throw noRecord("Pipedrive"); id = Number(await pipedrive.pushContact(cfg, l, {})); }
    const r = await call<{ data: { id: number } }>("Pipedrive", pd(cfg, "/notes"), { method: "POST", json: { person_id: id, content: replyNote(l, reply).replace(/\n/g, "<br>") } });
    return String(r.data.id);
  },
};

// ── Attio (API key, v2) ────────────────────────────────────────────────────────
const AT = "https://api.attio.com/v2";
const atAuth = (cfg: Config) => ({ Authorization: `Bearer ${need(cfg)}` });

async function atAssert(cfg: Config, l: Lead): Promise<string> {
  if (!l.email) throw new IntegrationError("Attio matches people by email, and this lead has none", true);
  const { first, last } = splitName(l);
  const values: Record<string, unknown> = { email_addresses: [l.email], name: [{ first_name: first, last_name: last, full_name: [first, last].filter(Boolean).join(" ") || l.email }] };
  if (l.title) values.job_title = l.title;
  if (l.linkedin_url) values.linkedin = l.linkedin_url;
  const r = await call<{ data: { id: { record_id: string } } }>("Attio", `${AT}/objects/people/records?matching_attribute=email_addresses`, { method: "PUT", headers: atAuth(cfg), json: { data: { values } } });
  return r.data.id.record_id;
}
async function atFind(cfg: Config, email: string): Promise<string | null> {
  const r = await call<{ data: Array<{ id: { record_id: string } }> }>("Attio", `${AT}/objects/people/records/query`, { method: "POST", headers: atAuth(cfg), json: { filter: { email_addresses: email }, limit: 1 } });
  return r.data?.[0]?.id.record_id ?? null;
}

export const attio: Adapter = {
  async verify(cfg) {
    const r = await call<{ active?: boolean; workspace_name?: string }>("Attio", `${AT}/self`, { headers: atAuth(cfg) });
    if (!r.active) throw new IntegrationError("Attio says this API key is revoked or unknown", true, 401);
    return { account: r.workspace_name };
  },
  pushContact: (cfg, l) => atAssert(cfg, l),
  async addReply(cfg, l, reply, { create }) {
    let id = l.email ? await atFind(cfg, l.email) : null;
    if (!id) { if (!create) throw noRecord("Attio"); id = await atAssert(cfg, l); }
    const r = await call<{ data: { id: { note_id: string } } }>("Attio", `${AT}/notes`, {
      method: "POST", headers: atAuth(cfg),
      json: { data: { parent_object: "people", parent_record_id: id, title: `${reply.channel === "linkedin" ? "LinkedIn" : "Email"} reply`, format: "plaintext", content: replyNote(l, reply) } },
    });
    return r.data?.id?.note_id ?? null;
  },
};

// ── Folk (API key, v1) ─────────────────────────────────────────────────────────
const FK = "https://api.folk.app/v1";
const fkAuth = (cfg: Config) => ({ Authorization: `Bearer ${need(cfg)}` });
const items = <T>(r: unknown): T[] => {
  const o = r as { data?: { items?: T[] } | T[]; items?: T[] };
  return (Array.isArray(o?.data) ? o.data : o?.data?.items ?? o?.items ?? []) as T[];
};

export const folk: Adapter = {
  async verify(cfg) {
    const r = await call<{ data?: { fullName?: string; email?: string } }>("Folk", `${FK}/users/me`, { headers: fkAuth(cfg) });
    return { account: r.data?.fullName ?? r.data?.email };
  },
  async choices(cfg) {
    return items<{ id: string; name: string }>(await call("Folk", `${FK}/groups?limit=100`, { headers: fkAuth(cfg) })).map((g) => ({ value: g.id, label: g.name }));
  },
  async pushContact(cfg, l) {
    const { first, last } = splitName(l);
    const body: Record<string, unknown> = { firstName: first, lastName: last, fullName: l.full_name ?? [first, last].filter(Boolean).join(" ") };
    if (l.title) body.jobTitle = l.title;
    if (l.email) body.emails = [l.email];
    if (l.linkedin_url) body.urls = [l.linkedin_url];
    if (l.company) body.companies = [{ name: l.company }];
    if (cfg.choice) body.groups = [{ id: cfg.choice }];
    const r = await call<{ data?: { id?: string } }>("Folk", `${FK}/people`, { method: "POST", headers: { ...fkAuth(cfg), "Idempotency-Key": `kairo-${l.id}` }, json: body });
    return r.data?.id ?? null;
  },
};

// ── Breakcold (API key, REST v3) ───────────────────────────────────────────────
const BC = "https://api.breakcold.com/rest";
const bcAuth = (cfg: Config) => ({ "X-API-KEY": need(cfg) });

export const breakcold: Adapter = {
  async verify(cfg) {
    const r = await call<{ email?: string; name?: string }>("Breakcold", `${BC}/me`, { headers: bcAuth(cfg) });
    return { account: r?.name ?? r?.email };
  },
  async pushContact(cfg, l) {
    const { first, last } = splitName(l);
    const body: Record<string, unknown> = { first_name: first, last_name: last };
    if (l.email) body.email = l.email;
    if (l.company) body.company = l.company;
    if (l.title) body.company_role = l.title;
    if (l.linkedin_url) body.linkedin_url = l.linkedin_url;
    const r = await call<{ id?: string; data?: { id?: string } }>("Breakcold", `${BC}/lead`, { method: "POST", headers: bcAuth(cfg), json: body });
    return r?.id ?? r?.data?.id ?? null;
  },
};
