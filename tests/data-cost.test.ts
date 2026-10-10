import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Enrichment is the paid step: record what it is asked to read instead of calling treg.
const enrichCalls: Array<{ ids: string[]; funding: boolean | undefined }> = [];
vi.mock("@/lib/treg/enrich", () => ({
  enrichForScoring: async (_db: unknown, _ws: string, ids: string[], opts: { funding?: boolean } = {}) => { enrichCalls.push({ ids, funding: opts.funding }); return 0; },
}));
vi.mock("@/lib/treg/client", async (orig) => ({ ...(await orig<typeof import("@/lib/treg/client")>()), tregEnabled: () => true }));

import { getDb } from "@/lib/db";
import { saveIcp } from "@/lib/icp/store";
import { createAgent, getAgent } from "@/lib/agents/store";
import { upsertLead } from "@/lib/signals/leads";
import { scoreNewLeads } from "@/lib/agents/fit";
import { aiRetryPolicy } from "@/lib/ai/client";
import { postState, shouldReadEngagers } from "@/lib/signals/sources/engagement";
import { reactionCount } from "@/lib/treg/linkedin";
import * as R from "@/lib/signals/schedule-rules";
import { gate, recordResult, syncUnits, type SourceUnit } from "@/lib/signals/scheduler";

const WS = "ws-data-cost";
const HOUR = 3_600_000;
const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO integrations (workspace_id, key, api_key) VALUES (?, 'openrouter', 'sk-test')").run(WS);
  db.prepare("INSERT INTO workspace_ai_config (workspace_id, default_model) VALUES (?, 'test/model')").run(WS);
  aiRetryPolicy.baseDelayMs = 0;
});
afterEach(() => { vi.unstubAllGlobals(); enrichCalls.length = 0; });

let n = 0;
function newAgent() {
  const a = createAgent(WS, { name: `Cost ${++n}`, mode: "copilot", min_score: 10, fit_weight: 1, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
  return getAgent(a.id, WS)!;
}

describe("free checks before paid enrichment", () => {
  it("never pays to read a lead the free rules reject, and skips funding unless the funding signal is on", async () => {
    const a = newAgent();
    const icp = saveIcp(WS, { company_name: "Kairo", offer: "Outbound", personas: [{ name: "Sales", titles: ["VP Sales"], seniority: [], departments: [], pains: [] }], competitors: [], exclude_service_providers: true, exclusions: ["Globex"] }, "https://kairo.example", null);
    const db = getDb();
    const lead = (headline: string) => upsertLead(db, WS, a.id, { name: `P${++n}`, headline, profileUrl: `https://www.linkedin.com/in/cost-${n}` }).targetId;
    const agency = lead("Founder at Growth Agency | lead gen consultant");
    const excluded = lead("VP Sales at Globex");
    const good = lead("VP Sales at Initech");
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const leads = JSON.parse(JSON.parse(init?.body ?? "{}").messages[1].content).data.leads as Array<{ index: number }>;
      return reply({ leads: leads.map((l) => ({ index: l.index, fit_score: 80, verdict: "strong", reason: "fits" })) });
    }));
    await scoreNewLeads(db, a, icp.data, icp.id);
    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0].ids).toEqual([good]);
    expect(enrichCalls[0].funding).toBe(false);
    const reason = (id: string) => (db.prepare("SELECT agent_status, fit_reason FROM targets WHERE id = ?").get(id) as { agent_status: string; fit_reason: string });
    expect(reason(agency)).toMatchObject({ agent_status: "disqualified", fit_reason: expect.stringMatching(/service provider/) });
    expect(reason(excluded)).toMatchObject({ agent_status: "disqualified", fit_reason: expect.stringMatching(/Globex/) });

    // With "Companies that have recently raised funds" on, the funding lookup is allowed.
    db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, enabled) VALUES (?, ?, ?, 'funding', 1)").run(`fund-${a.id}`, a.id, WS);
    lead("Head of Sales at Hooli");
    await scoreNewLeads(db, a, icp.data, icp.id);
    expect(enrichCalls.at(-1)?.funding).toBe(true);
  });
});

describe("engager re-reads", () => {
  const T0 = Date.parse("2026-10-07T10:00:00Z");
  const at = (h: number) => new Date(T0 + h * HOUR).toISOString();
  it("reads a post at first sight, at a day and at three days, then never", () => {
    expect(shouldReadEngagers(null, null, T0)).toBe(true);
    const once = { first: at(0), reads: 1, last: at(0) };
    expect(shouldReadEngagers(once, null, T0 + 8 * HOUR)).toBe(false);
    expect(shouldReadEngagers(once, null, T0 + 25 * HOUR)).toBe(true);
    const twice = { first: at(0), reads: 2, last: at(25) };
    expect(shouldReadEngagers(twice, null, T0 + 48 * HOUR)).toBe(false);
    expect(shouldReadEngagers(twice, null, T0 + 73 * HOUR)).toBe(true);
    expect(shouldReadEngagers({ first: at(0), reads: 3, last: at(73) }, null, T0 + 200 * HOUR)).toBe(false);
  });
  it("skips a due re-read when the reaction count hasn't grown", () => {
    const once = { first: at(0), reads: 1, last: at(0), reactions: 40 };
    expect(shouldReadEngagers(once, 42, T0 + 25 * HOUR)).toBe(false);
    expect(shouldReadEngagers(once, 60, T0 + 25 * HOUR)).toBe(true);
  });
  it("understands the old cursor format and reads reaction counts from provider rows", () => {
    expect(postState("2026-10-07T10:00:00Z")).toEqual({ first: "2026-10-07T10:00:00Z", reads: 1, last: "2026-10-07T10:00:00Z" });
    expect(reactionCount({ numLikes: 12 })).toBe(12);
    expect(reactionCount({ stats: { total_reactions: "31" } })).toBe(31);
    expect(reactionCount({ text: "hi" })).toBeNull();
  });
});

describe("cost-aware cadence and budget", () => {
  it("speeds up only cheap items and slows expensive ones", () => {
    expect(R.adaptiveInterval("keyword_engagement", 10, 0, 50_000)).toBe(6); // $0.005 per lead: speed up
    expect(R.adaptiveInterval("keyword_engagement", 10, 0, 300_000)).toBe(12); // $0.03 per lead: hold
    expect(R.adaptiveInterval("keyword_engagement", 1, 0, 100_000)).toBe(24); // $0.10 per lead: slow down (at most 2x for cost)
    expect(R.agentBudgetUsd(null, undefined)).toBe(0.5);
    expect(R.agentBudgetUsd(2, undefined)).toBe(2);
  });

  it("holds an agent's data-provider units once its daily budget is spent, filler ones at 70%", () => {
    const db = getDb();
    const a = newAgent();
    db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, config_json) VALUES (?, ?, ?, 'funding', '{}'), (?, ?, ?, 'tech_stack', ?)")
      .run(`f-${a.id}`, a.id, WS, `t-${a.id}`, a.id, WS, JSON.stringify({ keywords: ["Intercom"] }));
    syncUnits(db);
    const units = (db.prepare("SELECT * FROM source_units WHERE agent_id = ?").all(a.id) as SourceUnit[]).map((u) => ({ ...u, linkedin_account_id: null, daily_lead_cap: 25, daily_data_budget_usd: null }));
    const funding = units.find((u) => u.source_type === "funding")!;
    const tech = units.find((u) => u.source_type === "tech_stack")!;
    const spend = (usd: number) => db.prepare("INSERT INTO treg_calls (id, workspace_id, endpoint, purpose, status, cost_micro, agent_id) VALUES (?, ?, 'x', 'x', 200, ?, ?)").run(`c-${Math.random()}`, WS, usd * 1e6, a.id);
    spend(0.36);
    expect(gate(db, funding, Date.now(), () => 0).ok).toBe(true);
    expect(gate(db, tech, Date.now(), () => 0)).toMatchObject({ ok: false, state: "waiting" });
    spend(0.2);
    expect(gate(db, funding, Date.now(), () => 0)).toMatchObject({ ok: false, note: expect.stringMatching(/data budget \(\$0\.50\)/) });

    recordResult(db, funding, { candidates: 3, ingested: 2, error: null, costMicro: 8000 });
    expect((db.prepare("SELECT cost_avg_micro c FROM source_units WHERE id = ?").get(funding.id) as { c: number }).c).toBe(8000);
  });
});
