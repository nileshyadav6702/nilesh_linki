import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Engager } from "@/lib/linkedin/engagers";

// A plain stub, not vi.fn: vitest's spy tracking reports a rejected async implementation as a
// test error even when the handler catches it.
const calls: Array<[string, string]> = [];
let engagersImpl: () => Promise<Engager[]> = async () => [];
const people = [{ name: "Vera Visitor", profileUrl: "https://www.linkedin.com/in/vera-visitor", headline: "VP Sales at Acme" }, { name: "Sam Search", profileUrl: "https://www.linkedin.com/in/sam-search", title: "Head of Growth" }];
vi.mock("@/lib/agents/audience-imports", () => ({ readPeopleSearchWithAccount: async () => people, readProfileVisitorsWithAccount: async () => people.slice(0, 1) }));
vi.mock("@/lib/agents/post-engagers", () => ({ POST_ENGAGER_LIMIT: 100, fetchPostEngagersWithAccount: (a: string, u: string) => { calls.push([a, u]); return engagersImpl(); } }));

import { getDb } from "@/lib/db";
import { createAgent, listSources, parseSourceConfig, type Agent } from "@/lib/agents/store";
import { nameFromProfileUrl } from "@/lib/agents/lead-imports";
import { AccountBusyError } from "@/lib/linkedin/account-session";
import { autoMap, reviewRows } from "@/lib/csv-rows";
import csvHandler from "@/pages/api/agents/[id]/import-csv";
import linkedinHandler from "@/pages/api/agents/[id]/linkedin-import";

const WS = "ws-lead-imports";
const USER = "user-lead-imports";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}
const req = (agentId: string, body: unknown) =>
  ({ method: "POST", query: { id: agentId }, body, headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" } }) as unknown as NextApiRequest;
async function call(handler: (q: NextApiRequest, s: NextApiResponse) => unknown, agentId: string, body: unknown) {
  const res = mockRes();
  await handler(req(agentId, body), res);
  return res;
}

let seq = 0;
function newAgent(name = `Imports ${++seq}`): Agent {
  return createAgent(WS, { name, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "multi", exclude_first_degree: true });
}
const attached = (agentId: string) => parseSourceConfig(listSources(agentId, WS).find((s) => s.source_type === "existing_list")?.config_json).list_ids;
const listCount = (listId: string) => (getDb().prepare("SELECT COUNT(*) n FROM list_targets WHERE list_id = ?").get(listId) as { n: number }).n;

const MAPPING = [
  { column: "first_name", kind: "standard", field: "first_name" },
  { column: "last_name", kind: "standard", field: "last_name" },
  { column: "linkedin", kind: "standard", field: "linkedin_url" },
  { column: "email", kind: "standard", field: "email" },
  { column: "company", kind: "standard", field: "company" },
  { column: "industry", kind: "standard", field: "company_industry" },
  { column: "deal_size", kind: "custom", key: "custom_deal_size", name: "deal_size", fieldType: "text" },
];
const CSV = [
  "First Name,Last Name,LinkedIn,Email,Company,Industry,Deal Size",
  "Rajiv,Mukherjee,https://www.linkedin.com/in/MukherjeeRajiv/,rajiv@mirai.vc,Mirai Ventures,VC,50k",
  "Meera,Sundar,linkedin.com/in/meerasundar,,Tetris,SaaS,",
  "Known,Person,https://linkedin.com/in/known-person,,Acme,,",
  "Repeat,Rajiv,https://www.linkedin.com/in/mukherjeerajiv,,Mirai,,",
  ",NoFirst,https://www.linkedin.com/in/nofirst,,X,,",
  "Bad,Url,https://example.com/jane,,X,,",
  "Mail,Only,,MAIL@Only.io,X,,",
].join("\n");

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(USER, "lead-imports@example.com");
  db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, cookies_json) VALUES ('acc-on', ?, 'On', 'on@x.io', 1, '{}'), ('acc-off', ?, 'Off', 'off@x.io', 0, NULL)").run(WS, WS);
  db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('li-target', ?, 'Target list')").run(WS);
});
beforeEach(() => { calls.length = 0; engagersImpl = async () => []; });

describe("CSV review helpers", () => {
  it("auto-maps headers and previews ready / duplicate / skipped rows", () => {
    const map = autoMap(["First Name", "Last Name", "LinkedIn", "E-mail", "Company Name", "Notes"]);
    expect(map).toMatchObject({ first_name: "First Name", last_name: "Last Name", linkedin_url: "LinkedIn", email: "E-mail", company: "Company Name", notes: "Notes" });
    const rows = reviewRows([
      { "First Name": "A", "Last Name": "B", LinkedIn: "linkedin.com/in/ab" },
      { "First Name": "A", "Last Name": "B", LinkedIn: "https://www.linkedin.com/in/AB/" },
      { "First Name": "", "Last Name": "C", LinkedIn: "linkedin.com/in/c" },
    ], map, []);
    expect(rows.map((r) => r.status)).toEqual(["ready", "duplicate", "skipped"]);
  });
});

describe("POST /api/agents/:id/import-csv", () => {
  it("imports mapped rows into '<agent> - CSV Import', dedupes in the workspace and attaches the list", async () => {
    const db = getDb();
    const agent = newAgent("VP of Sales");
    db.prepare("INSERT INTO targets (id, workspace_id, linkedin_url, full_name) VALUES ('t-known', ?, 'https://linkedin.com/in/known-person/', 'Known Person')").run(WS);

    const res = await call(csvHandler, agent.id, { csv: CSV, mapping: MAPPING });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ imported: 3, duplicates: 2, list_name: "VP of Sales - CSV Import" });
    const errors = res.body.errors as string[];
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/missing first or last name/);
    expect(errors.join(" ")).toMatch(/not a valid linkedin\.com\/in\/ URL/);

    const listId = res.body.list_id as string;
    expect(attached(agent.id)).toEqual([listId]);
    expect(listCount(listId)).toBe(4); // Rajiv, Meera, Known (existing), Mail Only
    const rajiv = db.prepare("SELECT id, linkedin_url, company_industry FROM targets WHERE workspace_id = ? AND email = 'rajiv@mirai.vc'").get(WS) as { id: string; linkedin_url: string; company_industry: string };
    expect(rajiv.linkedin_url).toBe("https://www.linkedin.com/in/mukherjeerajiv");
    expect(rajiv.company_industry).toBe("VC");
    expect((db.prepare("SELECT COUNT(*) n FROM targets WHERE workspace_id = ? AND linkedin_url LIKE '%known-person%'").get(WS) as { n: number }).n).toBe(1);
    const custom = db.prepare(`SELECT v.value_text FROM contact_custom_values v JOIN custom_field_definitions d ON d.id = v.field_id
      WHERE v.target_id = ? AND d.key = 'custom_deal_size'`).get(rajiv.id) as { value_text: string };
    expect(custom.value_text).toBe("50k");
    expect(db.prepare("SELECT email FROM targets WHERE workspace_id = ? AND email = 'mail@only.io'").get(WS)).toBeTruthy();

    // A second import reuses the list and creates nothing new.
    const again = await call(csvHandler, agent.id, { csv: CSV, mapping: MAPPING });
    expect(again.body).toMatchObject({ imported: 0, list_id: listId });
    expect((db.prepare("SELECT COUNT(*) n FROM lists WHERE workspace_id = ? AND name = 'VP of Sales - CSV Import'").get(WS) as { n: number }).n).toBe(1);
  });

  it("requires the name columns and a contact handle to be mapped", async () => {
    const agent = newAgent();
    const res = await call(csvHandler, agent.id, { csv: CSV, mapping: MAPPING.filter((m) => m.field !== "last_name") });
    expect(res.statusCode).toBe(400);
    const res2 = await call(csvHandler, agent.id, { csv: CSV, mapping: [{ column: "x", kind: "standard", field: "nope" }] });
    expect(res2.statusCode).toBe(400);
  });
});

describe("POST /api/agents/:id/linkedin-import", () => {
  it("imports a single profile into the chosen list and attaches it", async () => {
    const agent = newAgent();
    const res = await call(linkedinHandler, agent.id, { kind: "profile", profile_url: "linkedin.com/in/Jane-Doe-4b1a2c3/", list_id: "li-target" });
    expect(res.statusCode).toBe(200);
    expect(res.body.created).toBe(true);
    const t = getDb().prepare("SELECT full_name, linkedin_url, lead_source FROM targets WHERE id = ?").get(res.body.target_id) as Record<string, string>;
    expect(t).toMatchObject({ full_name: "Jane Doe", linkedin_url: "https://www.linkedin.com/in/jane-doe-4b1a2c3", lead_source: "linkedin_profile" });
    expect(attached(agent.id)).toContain("li-target");
    const dup = await call(linkedinHandler, agent.id, { kind: "profile", profile_url: "https://www.linkedin.com/in/jane-doe-4b1a2c3", list_id: "li-target" });
    expect(dup.body).toMatchObject({ created: false, target_id: res.body.target_id });
    expect((await call(linkedinHandler, agent.id, { kind: "profile", profile_url: "https://example.com/jane", list_id: "li-target" })).statusCode).toBe(400);
    expect(nameFromProfileUrl("https://www.linkedin.com/in/meerasundar")).toBe("Meerasundar");
  });

  it("rejects a disconnected account server-side before touching LinkedIn", async () => {
    const agent = newAgent();
    const post = await call(linkedinHandler, agent.id, { kind: "post_preview", post_url: "https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/", account_id: "acc-off" });
    expect(post.statusCode).toBe(400);
    expect(post.body.error).toMatch(/disconnected/);
    expect(calls).toHaveLength(0);
    const nav = await call(linkedinHandler, agent.id, { kind: "sales_nav", url: "https://www.linkedin.com/sales/lists/people/7123456", count: 100, account_id: "acc-off", list_id: "li-target" });
    expect(nav.statusCode).toBe(400);
    expect(getDb().prepare("SELECT 1 FROM list_imports WHERE list_id = 'li-target'").get()).toBeUndefined();
  });

  it("queues a capped Sales Navigator import and refuses regular LinkedIn search URLs", async () => {
    const agent = newAgent();
    const db = getDb();
    db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('li-nav', ?, 'Nav')").run(WS);
    expect((await call(linkedinHandler, agent.id, { kind: "sales_nav", url: "https://www.linkedin.com/search/results/people/?keywords=cfo", count: 10, account_id: "acc-on", list_id: "li-nav" })).statusCode).toBe(400);
    expect((await call(linkedinHandler, agent.id, { kind: "sales_nav", url: "https://www.linkedin.com/sales/lists/people/7123456", count: 5000, account_id: "acc-on", list_id: "li-nav" })).statusCode).toBe(400);
    const ok = await call(linkedinHandler, agent.id, { kind: "sales_nav", url: "https://www.linkedin.com/sales/lists/people/7123456", count: 120, account_id: "acc-on", list_id: "li-nav" });
    expect(ok.statusCode).toBe(202);
    expect(db.prepare("SELECT cap, account_id, status FROM list_imports WHERE list_id = 'li-nav'").get()).toMatchObject({ cap: 120, account_id: "acc-on", status: "scheduled" });
    expect(attached(agent.id)).toContain("li-nav");
    expect((await call(linkedinHandler, agent.id, { kind: "sales_nav", url: "https://www.linkedin.com/sales/lists/people/7123456", count: 10, account_id: "acc-on", list_id: "li-nav" })).statusCode).toBe(409);
  });

  it("previews and imports post reactors, and reports a busy account as 409", async () => {
    const agent = newAgent();
    const db = getDb();
    db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('li-post', ?, 'Post')").run(WS);
    const engager = (n: number, kind: "reaction" | "comment" = "reaction"): Engager => ({ name: `Fan ${n}`, firstName: "Fan", lastName: String(n), headline: "CFO at Acme", profileUrl: `https://www.linkedin.com/in/fan-${n}`, memberUrn: `urn:li:member:${n}`, imageUrl: null, kind, reactionType: "LIKE", commentText: null });
    engagersImpl = async () => [engager(1), engager(2), engager(3)];
    const postUrl = "https://www.linkedin.com/posts/acme_launch-activity-7312345678901234567-AbCd";
    const preview = await call(linkedinHandler, agent.id, { kind: "post_preview", post_url: postUrl, account_id: "acc-on" });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toMatchObject({ reactions: 3, comments: 0, activity_urn: "urn:li:activity:7312345678901234567" });
    expect(calls[0]).toEqual(["acc-on", "urn:li:activity:7312345678901234567"]);

    const imp = await call(linkedinHandler, agent.id, { kind: "post", post_url: postUrl, account_id: "acc-on", list_id: "li-post", reactions: true });
    expect(imp.statusCode).toBe(200);
    expect(imp.body).toMatchObject({ imported: 3, existing: 0 });
    expect(listCount("li-post")).toBe(3);
    expect(attached(agent.id)).toContain("li-post");

    engagersImpl = async () => { throw new AccountBusyError("acc-on"); };
    const busy = await call(linkedinHandler, agent.id, { kind: "post_preview", post_url: postUrl, account_id: "acc-on" });
    expect(busy.statusCode).toBe(409);
    expect((await call(linkedinHandler, agent.id, { kind: "post_preview", post_url: "https://www.linkedin.com/in/jane", account_id: "acc-on" })).statusCode).toBe(400);
  });
});

describe("LinkedIn search and profile visitor imports", () => {
  it("checks the search URL and imports read people into the list", async () => {
    const agent = newAgent();
    const bad = await call(linkedinHandler, agent.id, { kind: "search", url: "https://www.linkedin.com/feed/", count: 10, account_id: "acc-on", list_id: "li-target" });
    expect(bad.statusCode).toBe(400);
    const off = await call(linkedinHandler, agent.id, { kind: "visitors", account_id: "acc-off", list_id: "li-target" });
    expect(off.statusCode).toBeGreaterThanOrEqual(400);
    const search = await call(linkedinHandler, agent.id, { kind: "search", url: "https://www.linkedin.com/search/results/people/?keywords=vp%20sales", count: 10, account_id: "acc-on", list_id: "li-target" });
    expect(search.statusCode).toBe(200);
    expect(search.body).toMatchObject({ list_id: "li-target" });
    const visitors = await call(linkedinHandler, agent.id, { kind: "visitors", account_id: "acc-on", list_id: "li-target" });
    expect(visitors.statusCode).toBe(200);
    expect(attached(agent.id)).toContain("li-target");
    expect(getDb().prepare("SELECT COUNT(*) n FROM targets WHERE workspace_id = ? AND linkedin_url LIKE ?").get(WS, "%vera-visitor%")).toEqual({ n: 1 });
  });
});
