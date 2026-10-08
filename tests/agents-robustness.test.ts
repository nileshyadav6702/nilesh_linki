import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { saveIcp, getLatestIcp } from "@/lib/icp/store";
import { createAgent, getAgent, type Agent } from "@/lib/agents/store";
import { upsertLead } from "@/lib/signals/leads";
import { scoreNewLeads } from "@/lib/agents/fit";
import { runAgentPass } from "@/lib/agents/loop";
import { inBackoff, failureInfo, resetBackoff } from "@/lib/agents/backoff";
import { aiRetryPolicy, AiCreditError } from "@/lib/ai/client";

const WS = "ws-agents-rb";
const WS_NOAI = "ws-agents-noai";
const ACCOUNT = "acct-agents-rb";
const WORKFLOW = "wf-agents-rb";

const reply = (content: unknown, status = 200) => new Response(JSON.stringify(status === 200
  ? { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }
  : { error: { message: `status ${status}` } }), { status, headers: { "Content-Type": "application/json" } });

const userOf = (init?: { body?: string }) => JSON.parse(JSON.parse(init?.body ?? "{}").messages[1].content);
const status = (id: string) => (getDb().prepare("SELECT agent_status FROM targets WHERE id = ?").get(id) as { agent_status: string }).agent_status;

function agentIn(ws: string, name: string): Agent {
  const a = createAgent(ws, { name, mode: "copilot", min_score: 10, fit_weight: 0.6, workflow_id: ws === WS ? WORKFLOW : null, linkedin_account_id: ws === WS ? ACCOUNT : null, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
  return getAgent(a.id, ws)!;
}
let seq = 0;
function lead(ws: string, agent: Agent, extra: { headline?: string; title?: string; name?: string } = {}) {
  seq++;
  return upsertLead(getDb(), ws, agent.id, { name: extra.name ?? `Lead ${seq}`, headline: extra.headline, title: extra.title, profileUrl: `https://www.linkedin.com/in/rb-${seq}` }).targetId;
}

beforeAll(() => {
  const db = getDb();
  for (const [id, slug] of [[WS, "agents-rb"], [WS_NOAI, "agents-noai"]]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(id, id, slug);
  db.prepare("INSERT INTO accounts (id, name, email, workspace_id, is_authenticated) VALUES (?, 'Me', 'me@rb.com', ?, 1)").run(ACCOUNT, WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, 'RB', ?)").run(WORKFLOW, WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES ('rb-st-1', ?, 1, 'message', 'linkedin')").run(WORKFLOW);
  db.prepare("INSERT INTO integrations (workspace_id, key, api_key) VALUES (?, 'openrouter', 'sk-test')").run(WS);
  db.prepare("INSERT INTO workspace_ai_config (workspace_id, default_model) VALUES (?, 'test/model')").run(WS);
  for (const ws of [WS, WS_NOAI]) saveIcp(ws, { company_name: "Linki", offer: "Outbound", personas: [{ name: "Sales", titles: ["VP Sales"], seniority: [], departments: [], pains: [] }], competitors: [] }, "https://linki.example", null);
  aiRetryPolicy.baseDelayMs = 0;
});
beforeEach(() => { resetBackoff(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("needs_data instead of disqualifying thin leads", () => {
  it("parks a lead with no headline or about, then scores it once a headline arrives", async () => {
    const agent = agentIn(WS_NOAI, "Thin");
    const id = lead(WS_NOAI, agent, { title: "VP Sales" });
    const icp = getLatestIcp(WS_NOAI)!;
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id)).toBe(0);
    expect(status(id)).toBe("needs_data");
    // Still waiting: re-running does not score it.
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id)).toBe(0);
    expect(status(id)).toBe("needs_data");
    // Profile enrichment fills the headline → eligible again.
    getDb().prepare("UPDATE targets SET headline = 'VP Sales at Acme' WHERE id = ?").run(id);
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id)).toBe(1);
    expect(status(id)).toBe("qualified");
  });

  it("the wizard preview can still score thin leads from the title", async () => {
    const agent = agentIn(WS_NOAI, "Preview thin");
    const id = lead(WS_NOAI, agent, { title: "VP Sales" });
    const icp = getLatestIcp(WS_NOAI)!;
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id, 5, { requireProfileText: false })).toBe(1);
    expect(status(id)).toBe("qualified");
  });
});

describe("scoring failure isolation", () => {
  it("one failed batch does not stop the next, and failed leads back off", async () => {
    const agent = agentIn(WS, "Batches");
    const bad = Array.from({ length: 10 }, () => lead(WS, agent, { name: "Bad Lead", headline: "VP Sales at Bad" }));
    for (const id of bad) getDb().prepare("UPDATE targets SET intent_score = 50 WHERE id = ?").run(id);
    const good = [lead(WS, agent, { name: "Good One", headline: "VP Sales at Good" }), lead(WS, agent, { name: "Good Two", headline: "VP Sales at Good" })];
    const fetchMock = vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const leads = userOf(init).data.leads as Array<{ index: number; name: string }>;
      if (leads.some((l) => l.name === "Bad Lead")) return reply(null, 500);
      return reply({ leads: leads.map((l) => ({ index: l.index, fit_score: 80, verdict: "strong", reason: "ok" })) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const icp = getLatestIcp(WS)!;
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id)).toBe(2);
    expect(good.map(status)).toEqual(["qualified", "qualified"]);
    expect(bad.every((id) => status(id) === "new" && inBackoff("score", id))).toBe(true);
    expect(failureInfo("score", bad[0])?.attempts).toBe(1);
    // Next tick: the failed leads are in backoff, so the model is not asked again.
    fetchMock.mockClear();
    expect(await scoreNewLeads(getDb(), agent, icp.data, icp.id)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an out-of-credit error is surfaced on the agent instead of silently skipping leads", async () => {
    const agent = agentIn(WS, "Credit");
    const id = lead(WS, agent, { headline: "VP Sales at Acme" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(null, 402)));
    const icp = getLatestIcp(WS)!;
    await expect(scoreNewLeads(getDb(), agent, icp.data, icp.id)).rejects.toBeInstanceOf(AiCreditError);
    expect(status(id)).toBe("new");
    await runAgentPass(agent);
    const row = getDb().prepare("SELECT last_error FROM agents WHERE id = ?").get(agent.id) as { last_error: string };
    expect(row.last_error).toMatch(/^score: /);
  });
});

describe("drafting", () => {
  it("does not mark a lead drafted when the model returns no usable step", async () => {
    const agent = agentIn(WS, "Drafts");
    const id = lead(WS, agent, { headline: "VP Sales at Acme" });
    getDb().prepare("UPDATE targets SET agent_status = 'qualified', lead_score = 90, scored_icp_id = ? WHERE id = ?").run(getLatestIcp(WS)!.id, id);
    const fetchMock = vi.fn(async () => reply({ steps: [{ key: "not-a-step", subject: null, body: "Hello there, a real message." }] }));
    vi.stubGlobal("fetch", fetchMock);
    const pass = await runAgentPass(agent);
    expect(pass.drafted).toBe(0);
    expect(status(id)).toBe("qualified");
    expect(getDb().prepare("SELECT COUNT(*) n FROM approval_queue WHERE target_id = ?").get(id)).toEqual({ n: 0 });
    expect(inBackoff("draft", id)).toBe(true);
    // Backed off: the next pass does not ask the model again for this lead.
    fetchMock.mockClear();
    await runAgentPass(agent);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
