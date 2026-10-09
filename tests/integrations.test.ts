import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { upsertLead } from "@/lib/signals/leads";
import appApi from "@/pages/api/integrations/[app]";
import oauthApi from "@/pages/api/integrations/oauth/[app]";
import { getConnection, saveConnection } from "@/lib/integrations/store";
import { enqueueNew, processDue } from "@/lib/integrations/worker";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-integrations-0123456789";
const WS = "ws-integrations";
const USER = "u-integrations";

function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, req: { method: string; query?: Record<string, unknown>; body?: unknown }) {
  let status = 200; let body: unknown; let location: string | undefined;
  const res = {
    status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; }, setHeader() { return res; }, end() { return res; },
    redirect(s: number, url: string) { status = s; location = url; return res; },
  } as unknown as NextApiResponse;
  const r = { query: {}, headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "owner", host: "localhost:3456" }, ...req } as unknown as NextApiRequest;
  return Promise.resolve(handler(r, res)).then(() => ({ status, body: body as Record<string, unknown>, location }));
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let n = 0;
function qualifiedLead(email: string | null) {
  n++;
  const id = upsertLead(getDb(), WS, null, { name: `Sync Lead${n}`, firstName: "Sync", lastName: `Lead${n}`, profileUrl: `https://www.linkedin.com/in/sync-${n}` }).targetId;
  getDb().prepare("UPDATE targets SET agent_status = 'qualified', agent_status_at = datetime('now', '+1 second'), email = ?, title = 'CTO', company = 'Acme' WHERE id = ?").run(email, id);
  return id;
}
const syncRow = (app: string, ref: string) => getDb().prepare("SELECT status, last_error, external_id FROM integration_syncs WHERE workspace_id = ? AND app = ? AND ref = ?").get(WS, app, ref) as { status: string; last_error: string | null; external_id: string | null };

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'integrations@example.com', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(WS, USER);
});
afterEach(() => vi.unstubAllGlobals());

describe("integrations", () => {
  it("verifies the key before connecting and refuses a bad one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { message: "bad" })));
    const bad = await call(appApi, { method: "PUT", query: { app: "hubspot" }, body: { fields: { api_key: "pat-bad" }, options: { auto_sync: true } } });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toMatch(/rejected the credentials/);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { portalId: 42 })));
    const ok = await call(appApi, { method: "PUT", query: { app: "hubspot" }, body: { fields: { api_key: "pat-good" }, options: { auto_sync: true, reply_notes: true } } });
    expect(ok.body).toMatchObject({ ok: true, account: "Portal 42" });
    expect(getConnection(getDb(), WS, "hubspot")?.config.api_key).toBe("pat-good");
    // Saving again with the masked key keeps the stored one.
    await call(appApi, { method: "PUT", query: { app: "hubspot" }, body: { fields: { api_key: "••••••••good" }, options: { auto_sync: true, reply_notes: true } } });
    expect(getConnection(getDb(), WS, "hubspot")?.config.api_key).toBe("pat-good");
  });

  it("pushes newly qualified leads with an email upsert", async () => {
    const db = getDb();
    const lead = qualifiedLead("ada@acme.com");
    enqueueNew(db, WS, getConnection(db, WS, "hubspot")!);
    const fetchMock = vi.fn(async () => json(200, { results: [{ id: "hs-1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await processDue(db);
    expect(syncRow("hubspot", lead)).toMatchObject({ status: "done", external_id: "hs-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert");
    expect(JSON.parse(String(init.body)).inputs[0]).toMatchObject({ idProperty: "email", id: "ada@acme.com", properties: { email: "ada@acme.com", jobtitle: "CTO", company: "Acme" } });
  });

  it("waits for an email when the tool needs one, and stops the app when the key is rejected", async () => {
    const db = getDb();
    saveConnection(db, WS, "smartlead", { api_key: "k", choice: "7", choice_label: "Main" }, { auto_sync: true }, USER);
    db.prepare("UPDATE integration_connections SET created_at = datetime('now', '-1 minute') WHERE workspace_id = ? AND app = 'smartlead'").run(WS);
    const noEmail = qualifiedLead(null);
    enqueueNew(db, WS, getConnection(db, WS, "smartlead")!);
    vi.stubGlobal("fetch", vi.fn(async () => json(403, {})));
    await processDue(db);
    expect(syncRow("smartlead", noEmail)).toMatchObject({ status: "pending", last_error: "Waiting for an email address" });
    expect(getConnection(db, WS, "smartlead")?.status).toBe("error");
  });

  it("logs replies as notes on the matching contact", async () => {
    const db = getDb();
    const lead = qualifiedLead("grace@acme.com");
    const thread = randomUUID();
    db.prepare(`INSERT INTO inbox_threads (id, workspace_id, channel, account_id, external_id, participant_name, participant_email, target_id, last_message_at)
      VALUES (?, ?, 'email', 'acc-x', ?, 'Grace Hopper', 'grace@acme.com', ?, datetime('now'))`).run(thread, WS, thread, lead);
    const msg = randomUUID();
    db.prepare("INSERT INTO inbox_messages (id, thread_id, external_id, direction, body_text, sent_at) VALUES (?, ?, ?, 'in', 'Sounds good, call me', datetime('now', '+2 seconds'))").run(msg, thread, msg);
    enqueueNew(db, WS, getConnection(db, WS, "hubspot")!);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("idProperty=email") ? json(200, { id: "hs-9" }) : json(201, { id: "note-1" }))));
    await processDue(db);
    expect(syncRow("hubspot", msg)).toMatchObject({ status: "done", external_id: "note-1" });
  });

  it("starts Salesforce sign-in with state and PKCE on the configured login host", async () => {
    saveConnection(getDb(), WS, "salesforce", { instance_url: "https://test.salesforce.com", client_id: "cid", client_secret: "sec" }, { auto_sync: true }, USER, "pending_oauth");
    const r = await call(oauthApi, { method: "GET", query: { app: "salesforce", step: "start" } });
    expect(r.status).toBe(302);
    const u = new URL(r.location!);
    expect(u.origin).toBe("https://test.salesforce.com");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/integrations\/oauth\/salesforce$/);
    const bad = await call(oauthApi, { method: "GET", query: { app: "salesforce", code: "x", state: "forged" } });
    expect(bad.location).toMatch(/error=/);
  });

  it("refuses webhook URLs that aren't public", async () => {
    const r = await call(appApi, { method: "PUT", query: { app: "webhook" }, body: { webhooks: [{ url: "http://127.0.0.1/hook", trigger: "lead" }], options: { auto_sync: true } } });
    expect(r.status).toBe(400);
  });
});
