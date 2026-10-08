import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { createAgent, listSources, parseSourceConfig, type Agent } from "@/lib/agents/store";
import { countSignals, isSalesNavUrl, normalizeCompanyUrl, parseTopics, postActivityId, SIGNAL_BUDGET } from "@/lib/agents/lead-source-rules";
import sourcesHandler from "@/pages/api/agents/[id]/sources";

const WS = "ws-lead-sources";
const OTHER = "ws-lead-sources-other";
const USER = "user-lead-sources";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
const req = (agentId: string, method: string, body?: unknown, ws = WS) =>
  ({ method, query: { id: agentId }, body, headers: { "x-workspace-id": ws, "x-user-id": USER, "x-workspace-role": "admin" } }) as unknown as NextApiRequest;

async function put(agentId: string, body: unknown) {
  const res = mockRes();
  await sourcesHandler(req(agentId, "PUT", body), res);
  return res;
}

let seq = 0;
function newAgent(): Agent {
  return createAgent(WS, { name: `Sources ${++seq}`, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "multi", exclude_first_degree: true });
}
const byType = (agentId: string, type: string) => listSources(agentId, WS).find((s) => s.source_type === type);

beforeAll(() => {
  const db = getDb();
  for (const ws of [WS, OTHER]) db.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(USER, "lead-sources@example.com");
  for (const ws of [WS, OTHER]) db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(ws, USER);
});

describe("lead source rules", () => {
  it("normalises LinkedIn URLs, topics, post and Sales Nav URLs", () => {
    expect(normalizeCompanyUrl("linkedin.com/company/Lemlist/about/")).toBe("https://www.linkedin.com/company/lemlist");
    expect(normalizeCompanyUrl("https://www.linkedin.com/in/jane")).toBeNull();
    expect(parseTopics("buyer intent, rev ops automation").topics).toEqual(["buyer intent", "rev ops automation"]);
    expect(parseTopics("one two three four").error).toMatch(/more than 3 words/);
    expect(postActivityId("https://www.linkedin.com/posts/jane_hello-activity-7312345678901234567-AbCd")).toBe("7312345678901234567");
    expect(postActivityId("https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/")).toBe("7312345678901234567");
    expect(isSalesNavUrl("https://www.linkedin.com/sales/lists/people/7123456")).toBe(true);
    expect(isSalesNavUrl("https://www.linkedin.com/search/results/people/?keywords=cfo")).toBe(false);
    expect(countSignals({ keyword_engagement: { enabled: true, config: { keywords: ["a b", "c"] } }, funding: { enabled: true, config: {} }, hiring: { enabled: false, config: {} } })).toBe(3);
  });
});

describe("PUT /api/agents/:id/sources", () => {
  it("rejects unknown types, bad URLs, long topics and job openings without boards", async () => {
    const a = newAgent();
    expect((await put(a.id, { sources: [{ source_type: "website_visit", enabled: true, config: {} }] })).statusCode).toBe(400);
    const badUrl = await put(a.id, { sources: [{ source_type: "competitor_engagement", enabled: true, config: { urls: ["https://www.linkedin.com/in/someone"] } }] });
    expect(badUrl.statusCode).toBe(400);
    expect((badUrl.body as { error: string }).error).toMatch(/company page/);
    expect((await put(a.id, { sources: [{ source_type: "keyword_engagement", enabled: true, config: { keywords: ["one two three four"] } }] })).statusCode).toBe(400);
    expect((await put(a.id, { sources: [{ source_type: "hiring", enabled: true, config: { boards: [] } }] })).statusCode).toBe(400);
    expect((await put(a.id, { sources: [{ source_type: "keyword_engagement", enabled: true, config: { keywords: ["ok"], extra: 1 } }] })).statusCode).toBe(400);
    expect(listSources(a.id, WS)).toHaveLength(0);
  });

  it("saves one row per type, canonicalises URLs and keeps knobs the drawer does not edit", async () => {
    const a = newAgent();
    const r1 = await put(a.id, { sources: [
      { source_type: "competitor_engagement", enabled: true, config: { urls: ["linkedin.com/company/Lemlist/"] } },
      { source_type: "funding", enabled: true, config: {} },
      { source_type: "job_change", enabled: false, config: {} },
    ] });
    expect(r1.statusCode).toBe(200);
    const comp = byType(a.id, "competitor_engagement")!;
    expect(parseSourceConfig(comp.config_json).urls).toEqual(["https://www.linkedin.com/company/lemlist"]);
    expect(byType(a.id, "funding")!.enabled).toBe(1);
    expect(byType(a.id, "job_change")).toBeUndefined(); // disabled + never created → no row

    getDb().prepare("UPDATE agent_sources SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...parseSourceConfig(comp.config_json), posts_per_entity: 7 }), comp.id);
    const r2 = await put(a.id, { sources: [{ source_type: "competitor_engagement", enabled: true, config: { urls: ["https://www.linkedin.com/company/lemlist", "https://www.linkedin.com/company/apollo-io"] } }] });
    expect(r2.statusCode).toBe(200);
    const after = parseSourceConfig(byType(a.id, "competitor_engagement")!.config_json);
    expect(after.urls).toHaveLength(2);
    expect(after.posts_per_entity).toBe(7);
    expect(listSources(a.id, WS).filter((s) => s.source_type === "competitor_engagement")).toHaveLength(1);

    const r3 = await put(a.id, { sources: [{ source_type: "funding", enabled: false, config: {} }] });
    expect(r3.statusCode).toBe(200);
    expect(byType(a.id, "funding")!.enabled).toBe(0);
  });

  it("refuses to grow past the signal budget", async () => {
    const a = newAgent();
    const keywords = Array.from({ length: 15 }, (_, i) => `topic ${i}`);
    expect((await put(a.id, { sources: [{ source_type: "keyword_engagement", enabled: true, config: { keywords } }] })).statusCode).toBe(200);
    const over = await put(a.id, { sources: [{ source_type: "funding", enabled: true, config: {} }] });
    expect(over.statusCode).toBe(400);
    expect((over.body as { error: string }).error).toContain(String(SIGNAL_BUDGET));
  });

  it("attaches and detaches lists on the existing-list source, workspace-scoped", async () => {
    const db = getDb();
    const a = newAgent();
    db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('ls-1', ?, 'Mine 1'), ('ls-2', ?, 'Mine 2')").run(WS, WS);
    db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('ls-foreign', ?, 'Theirs')").run(OTHER);
    expect((await put(a.id, { attach_list_ids: ["ls-foreign"] })).statusCode).toBe(404);
    expect((await put(a.id, { attach_list_ids: [a.list_id] })).statusCode).toBe(400); // the agent's own list
    expect((await put(a.id, { attach_list_ids: ["ls-1", "ls-2"] })).statusCode).toBe(200);
    expect(parseSourceConfig(byType(a.id, "existing_list")!.config_json).list_ids).toEqual(["ls-1", "ls-2"]);
    expect((await put(a.id, { detach_list_ids: ["ls-1"] })).statusCode).toBe(200);
    const row = byType(a.id, "existing_list")!;
    expect(parseSourceConfig(row.config_json).list_ids).toEqual(["ls-2"]);
    expect(row.enabled).toBe(1);
  });
});
