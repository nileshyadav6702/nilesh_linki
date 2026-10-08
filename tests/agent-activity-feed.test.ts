import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { createAgent, type Agent } from "@/lib/agents/store";
import { listAgentActivity, sourceTitle, type ActivityFeedItem } from "@/lib/agents/activity-feed";
import activityHandler from "@/pages/api/agents/[id]/activity";

const WS = "ws-activity-feed";
const OTHER = "ws-activity-feed-other";
const USER = "user-activity-feed";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
function get(agentId: string, query: Record<string, string> = {}, ws = WS) {
  const res = mockRes();
  activityHandler({ method: "GET", query: { id: agentId, ...query }, headers: { "x-workspace-id": ws, "x-user-id": USER, "x-workspace-role": "admin" } } as unknown as NextApiRequest, res);
  return res;
}

let seq = 0;
function newAgent(ws = WS): Agent {
  return createAgent(ws, { name: `Activity ${++seq}`, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "multi", exclude_first_degree: true });
}

const db = () => getDb();
function lead(agent: Agent, name: string, cols: Record<string, unknown> = {}, ws = WS): string {
  const id = `t-${++seq}`;
  const all: Record<string, unknown> = { id, workspace_id: ws, agent_id: agent.id, full_name: name, title: "CEO", company: "Acme", linkedin_url: `https://www.linkedin.com/in/${id}`, created_at: "2026-01-01 00:00:00", ...cols };
  const keys = Object.keys(all);
  db().prepare(`INSERT INTO targets (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => all[k]));
  return id;
}
function source(agent: Agent, type: string, config: unknown, createdAt: string): string {
  const id = `s-${++seq}`;
  db().prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, agent.id, agent.workspace_id, type, JSON.stringify(config), createdAt);
  return id;
}
function run(sourceId: string, ws: string, at: string, r: { candidates: number; ingested: number; filtered: number; error?: string }): string {
  const id = `r-${++seq}`;
  db().prepare("INSERT INTO detector_runs (id, agent_source_id, workspace_id, started_at, finished_at, candidates, ingested, filtered, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, sourceId, ws, at, at, r.candidates, r.ingested, r.filtered, r.error ?? null);
  return id;
}
function action(targetId: string, type: string, status: string, at: string, error: string | null = null) {
  const id = `la-${++seq}`;
  db().prepare("INSERT INTO linkedin_actions (id, idempotency_key, target_id, type, status, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, `k-${id}`, targetId, type, status, error, at, at);
}
const all = (agent: Agent, ws = WS) => listAgentActivity(db(), { workspaceId: ws, agentId: agent.id, limit: 100 });
const find = (items: ActivityFeedItem[], kind: string, pred: (i: ActivityFeedItem) => boolean = () => true) => items.find((i) => i.kind === kind && pred(i));

beforeAll(() => {
  for (const ws of [WS, OTHER]) db().prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db().prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(USER, "activity-feed@example.com");
  db().prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'viewer')").run(WS, USER);
});

describe("listAgentActivity", () => {
  it("maps discovery runs: title from config, qualified of found, failures and View leads", () => {
    const a = newAgent();
    const topic = source(a, "keyword_engagement", { keywords: ["signal-based prospecting"] }, "2026-02-01 00:00:00");
    const comp = source(a, "competitor_engagement", { urls: ["https://www.linkedin.com/company/lemlist"] }, "2026-02-01 00:00:01");
    const r1 = run(topic, WS, "2026-03-01 10:00:00", { candidates: 40, ingested: 3, filtered: 37 });
    run(comp, WS, "2026-03-01 09:00:00", { candidates: 0, ingested: 0, filtered: 0, error: "LinkedIn refused the request (HTTP 429)" });
    const q = lead(a, "Qualified One", { agent_status: "qualified", scored_at: "2026-03-01 11:00:00" });
    const d = lead(a, "Disqualified", { agent_status: "disqualified" });
    for (const t of [q, d]) db().prepare("INSERT INTO signals (id, workspace_id, target_id, type, title, occurred_at, detector_run_id, agent_id) VALUES (?, ?, ?, 'keyword_engagement', 'x', '2026-03-01', ?, ?)").run(`sg-${++seq}`, WS, t, r1, a.id);

    const { items } = all(a);
    const ok = find(items, "run", (i) => i.mark === "keyword_engagement")!;
    expect(ok).toMatchObject({ category: "discovery", title: "\"signal-based prospecting\"", subtitle: "Engagement & Interest", signal_type: "keyword_engagement" });
    expect(ok.outcome).toMatchObject({ text: "1 of 40 matched", tone: "positive" });
    const bad = find(items, "run", (i) => i.mark === "competitor_engagement")!;
    expect(bad).toMatchObject({ title: "https://www.linkedin.com/company/lemlist", subtitle: "Company competitor profile", signal_type: null });
    expect(bad.outcome).toMatchObject({ text: "Failed: LinkedIn refused the request (HTTP 429)", tone: "negative" });
  });

  it("maps campaign events per lead and prefers linkedin_actions over target timestamps", () => {
    const a = newAgent();
    const t1 = lead(a, "Tobias Münnich", { title: "CEO & Co-Founder", company: "Harucon-Ventures", profile_image_url: "https://img/x.jpg",
      connection_requested_at: "2026-03-02T08:00:00.000Z", connected_at: "2026-03-03T08:00:00.000Z", last_replied_at: "2026-03-04T08:00:00.000Z" });
    action(t1, "connect", "sent", "2026-03-02 08:00:00");
    action(t1, "message", "failed", "2026-03-03 09:00:00", "Message box not found");
    const t2 = lead(a, "Legacy Lead", { connection_requested_at: "2026-03-01T08:00:00.000Z", message_sent_at: "2026-03-01T09:00:00.000Z" });
    const t3 = lead(a, "Campbell Wilson", { email: "c@oldwell.com", apollo_enriched_at: "2026-03-05 10:00:00" });
    lead(a, "Imported Email", { email: "i@x.com" }); // no enrichment timestamp → no event

    const { items } = all(a);
    const of = (id: string) => items.filter((i) => i.lead?.id === id).map((i) => i.outcome?.text).sort();
    expect(of(t1)).toEqual(["Failed: Message box not found", "Invitation accepted", "Invitation sent", "Replied"]);
    expect(of(t2)).toEqual(["Invitation sent", "Message sent"]);
    expect(of(t3)).toEqual(["Email enriched"]);
    expect(items.some((i) => i.title === "Imported Email")).toBe(false);
    const accepted = find(items, "accepted")!;
    expect(accepted).toMatchObject({ category: "campaign", title: "Tobias Münnich", subtitle: "CEO & Co-Founder at Harucon-Ventures", lead: { photo: "https://img/x.jpg" } });
    expect(accepted.outcome?.tone).toBe("positive");
    expect(find(items, "li_action", (i) => i.outcome?.text.startsWith("Failed") ?? false)?.outcome?.tone).toBe("negative");
  });

  it("lists setup from created_at columns and the agent's audit log", () => {
    const a = newAgent();
    db().prepare("UPDATE agents SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(a.id);
    source(a, "funding", {}, "2026-01-02 00:00:00");
    const audit = db().prepare("INSERT INTO audit_logs (id, workspace_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'agent', ?, ?, ?)");
    audit.run(`al-${++seq}`, WS, "agent.updated", a.id, JSON.stringify({ fields: ["outreach_enabled"] }), "2026-01-03 00:00:00");
    audit.run(`al-${++seq}`, WS, "agent.updated", a.id, JSON.stringify({ fields: ["create_default_campaign"] }), "2026-01-03 00:00:01");
    audit.run(`al-${++seq}`, OTHER, "agent.updated", a.id, JSON.stringify({ fields: ["name"] }), "2026-01-03 00:00:02");

    const page = listAgentActivity(db(), { workspaceId: WS, agentId: a.id, category: "setup" });
    expect(page.items.map((i) => i.title)).toEqual(["Agent settings updated", "Lead source added", "Agent created"]);
    expect(page.items[0].subtitle).toBe("Outreach");
    expect(page.items[1]).toMatchObject({ subtitle: "Recently raised funds", mark: "funding" });
    expect(page.total).toBe(3);
    expect(sourceTitle("funding", "{}").title).toBe("Recently raised funds");
  });

  it("orders newest first, paginates in SQL and counts every category", () => {
    const a = newAgent();
    db().prepare("UPDATE agents SET created_at = '2025-01-01 00:00:00' WHERE id = ?").run(a.id);
    for (let i = 0; i < 7; i++) lead(a, `Lead ${i}`, { connection_requested_at: `2026-04-0${i + 1}T00:00:00.000Z` });
    const s = source(a, "hiring", {}, "2025-01-02 00:00:00");
    run(s, WS, "2026-04-03 12:00:00", { candidates: 5, ingested: 0, filtered: 5 });

    const first = listAgentActivity(db(), { workspaceId: WS, agentId: a.id, limit: 3, offset: 0 });
    expect(first.counts).toEqual({ all: 10, website: 0, discovery: 1, campaign: 7, setup: 2 });
    expect(first.total).toBe(10);
    expect(first.items.map((i) => i.title)).toEqual(["Lead 6", "Lead 5", "Lead 4"]);
    const second = listAgentActivity(db(), { workspaceId: WS, agentId: a.id, limit: 3, offset: 3 });
    expect(second.items.map((i) => i.title)).toEqual(["Lead 3", "Job openings", "Lead 2"]);
    const at = [...first.items, ...second.items].map((i) => Date.parse(i.at));
    expect([...at].sort((x, y) => y - x)).toEqual(at);
    const campaign = listAgentActivity(db(), { workspaceId: WS, agentId: a.id, category: "campaign", limit: 100 });
    expect(campaign.total).toBe(7);
    expect(campaign.items.every((i) => i.category === "campaign")).toBe(true);
  });

  it("is scoped to the agent and workspace", () => {
    const a = newAgent();
    const b = newAgent();
    lead(b, "Other Agent Lead", { connection_requested_at: "2026-05-01T00:00:00.000Z" });
    const foreign = newAgent(OTHER);
    lead(foreign, "Foreign Lead", { connection_requested_at: "2026-05-01T00:00:00.000Z" }, OTHER);
    expect(all(a).items.map((i) => i.kind)).toEqual(["agent_created"]);
    // The right agent id with the wrong workspace sees nothing.
    expect(listAgentActivity(db(), { workspaceId: WS, agentId: foreign.id }).counts.all).toBe(0);
  });
});

describe("GET /api/agents/:id/activity", () => {
  it("validates params and 404s an agent from another workspace", () => {
    const a = newAgent();
    expect(get(a.id).statusCode).toBe(200);
    expect((get(a.id).body as { counts: { setup: number } }).counts.setup).toBe(1);
    expect(get(a.id, { category: "bogus" }).statusCode).toBe(400);
    expect(get(a.id, { limit: "500" }).statusCode).toBe(400);
    expect(get(a.id, { offset: "-1" }).statusCode).toBe(400);
    expect(get(a.id, { category: "all", limit: "10" }).statusCode).toBe(200);
    expect(get(newAgent(OTHER).id).statusCode).toBe(404);
    expect(get("missing").statusCode).toBe(404);
  });
});
