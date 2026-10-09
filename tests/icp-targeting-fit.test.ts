import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { saveIcp, type IcpRecord } from "@/lib/icp/store";
import { createAgent, getAgent, type Agent } from "@/lib/agents/store";
import { upsertLead } from "@/lib/signals/leads";
import { fitInstructions, isQualified, scoreNewLeads } from "@/lib/agents/fit";
import { hasMandatoryKeyword, looksLikeServiceProvider, screenLead } from "@/lib/agents/fit-rules";
import { resetBackoff } from "@/lib/agents/backoff";
import { aiRetryPolicy } from "@/lib/ai/client";
import { icpSchema, type Icp } from "@/lib/icp/schema";
import { addRole, applyDraftTargeting, clearTargeting, hasTerm, removeRole, roleTitles, sizeLabel, SERVICE_PROVIDER_LABEL, toggleSize } from "@/lib/icp/targeting";

const WS = "ws-icp-targeting";
const ACCOUNT = "acct-icp-targeting";
const WORKFLOW = "wf-icp-targeting";

const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
const userOf = (init?: { body?: string }) => JSON.parse(JSON.parse(init?.body ?? "{}").messages[1].content) as { instructions: string[]; data: { icp: Record<string, unknown>; leads: Array<{ index: number; name: string }> } };
const row = (id: string) => getDb().prepare("SELECT agent_status, fit_reason FROM targets WHERE id = ?").get(id) as { agent_status: string; fit_reason: string | null };

const base: Partial<Icp> = { company_name: "Linki", offer: "Outbound automation", personas: [{ name: "Sales", titles: ["VP Sales"], seniority: [], departments: [], pains: [] }], competitors: [] };
const icpWith = (extra: Partial<Icp>): IcpRecord => saveIcp(WS, { ...base, ...extra }, "https://linki.example", null);

let n = 0;
function agent(minScore = 10): Agent {
  n++;
  const a = createAgent(WS, { name: `Targeting ${n}`, mode: "copilot", min_score: minScore, fit_weight: 1, workflow_id: WORKFLOW, linkedin_account_id: ACCOUNT, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
  return getAgent(a.id, WS)!;
}
function lead(a: Agent, extra: { name?: string; headline?: string; title?: string; company?: string } = {}) {
  n++;
  return upsertLead(getDb(), WS, a.id, { name: extra.name ?? `Person ${n}`, headline: extra.headline, title: extra.title, company: extra.company, profileUrl: `https://www.linkedin.com/in/tg-${n}` }).targetId;
}
const scoreAll = (fetchMock: ReturnType<typeof vi.fn>, fit: { fit_score: number; verdict: string }) => fetchMock.mockImplementation(async (_u: unknown, init?: { body?: string }) =>
  reply({ leads: userOf(init).data.leads.map((l) => ({ index: l.index, ...fit, reason: "model" })) }));

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, "icp-targeting");
  db.prepare("INSERT INTO accounts (id, name, email, workspace_id, is_authenticated) VALUES (?, 'Me', 'me@tg.com', ?, 1)").run(ACCOUNT, WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, 'TG', ?)").run(WORKFLOW, WS);
  db.prepare("INSERT INTO integrations (workspace_id, key, api_key) VALUES (?, 'openrouter', 'sk-test')").run(WS);
  db.prepare("INSERT INTO workspace_ai_config (workspace_id, default_model) VALUES (?, 'test/model')").run(WS);
  aiRetryPolicy.baseDelayMs = 0;
});
beforeEach(() => { resetBackoff(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ICP schema defaults", () => {
  it("parses ICPs stored before the targeting fields existed", () => {
    const icp = icpSchema.parse({ company_name: "Old" });
    expect(icp.match_mode).toBe("high_precision");
    expect(icp.exclude_service_providers).toBe(false);
    expect(icp.ai_competitor_filtering).toBe(false);
    expect(icp.mandatory_keywords).toEqual([]);
  });
});

describe("match_mode skip", () => {
  it("qualifies every lead without rules or a model call, thin leads included", async () => {
    const a = agent(95);
    const rec = icpWith({ match_mode: "skip", mandatory_keywords: ["blockchain"], exclusions: ["Acme"] });
    const ids = [lead(a, { headline: "Designer at Acme" }), lead(a, { title: "Student" })];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await scoreNewLeads(getDb(), a, rec.data, rec.id)).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const id of ids) expect(row(id)).toEqual({ agent_status: "qualified", fit_reason: "ICP filtering skipped" });
  });
});

describe("mandatory keywords", () => {
  it("disqualifies leads mentioning none of the keywords before the model is asked", async () => {
    const a = agent();
    const rec = icpWith({ mandatory_keywords: ["AI", "Web3"] });
    const miss = lead(a, { name: "Miss", headline: "VP Sales who said hello" });
    const hit = lead(a, { name: "Hit", headline: "VP Sales at an AI-first startup" });
    const fetchMock = vi.fn();
    scoreAll(fetchMock, { fit_score: 80, verdict: "strong" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await scoreNewLeads(getDb(), a, rec.data, rec.id)).toBe(2);
    expect(row(miss).agent_status).toBe("disqualified");
    expect(row(miss).fit_reason).toMatch(/Missing mandatory keywords/);
    expect(row(hit).agent_status).toBe("qualified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(userOf(fetchMock.mock.calls[0][1]).data.leads.map((l) => l.name)).toEqual(["Hit"]);
  });

  it("matches whole words case-insensitively", () => {
    expect(hasTerm("Building ai tools", "AI")).toBe(true);
    expect(hasTerm("She said yes", "AI")).toBe(false);
    expect(hasMandatoryKeyword({ headline: null, title: null, summary: "Into web3 payments", company: null }, ["Web3"])).toBe(true);
  });
});

describe("service providers and exclusions", () => {
  it("drops agencies and consultants when exclude_service_providers is on", async () => {
    const a = agent();
    const rec = icpWith({ exclude_service_providers: true });
    const agency = lead(a, { headline: "Founder at Growth Agency" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await scoreNewLeads(getDb(), a, rec.data, rec.id)).toBe(1);
    expect(row(agency).agent_status).toBe("disqualified");
    expect(row(agency).fit_reason).toMatch(/service provider/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats onboarding's service-provider phrase in exclusions as the switch", () => {
    const icp = icpSchema.parse({ exclusions: [SERVICE_PROVIDER_LABEL] });
    expect(screenLead({ headline: "Freelance designer", title: null, company: null, summary: null }, icp).ok).toBe(false);
    expect(looksLikeServiceProvider({ headline: "VP Sales", title: null, company: "Acme Software", summary: null })).toBe(false);
  });

  it("drops leads whose company matches an excluded company or keyword", async () => {
    const a = agent();
    const rec = icpWith({ exclusions: ["Apollo", "ZoomInfo"] });
    const excluded = lead(a, { headline: "VP Sales at Apollo.io", company: "Apollo.io" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await scoreNewLeads(getDb(), a, rec.data, rec.id);
    expect(row(excluded).agent_status).toBe("disqualified");
    expect(row(excluded).fit_reason).toContain("Apollo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes both settings into the scoring prompt", () => {
    const icp = icpSchema.parse({ exclude_service_providers: true });
    expect(fitInstructions(icp).join(" ")).toMatch(/agencies, consultancies/);
  });
});

describe("AI competitor filtering", () => {
  it("adds the unlisted-competitor instruction only when on", async () => {
    expect(fitInstructions(icpSchema.parse({})).join(" ")).not.toMatch(/even if it is not listed/);
    const a = agent();
    const rec = icpWith({ ai_competitor_filtering: true });
    lead(a, { headline: "VP Sales at Outreachly" });
    const fetchMock = vi.fn();
    scoreAll(fetchMock, { fit_score: 80, verdict: "strong" });
    vi.stubGlobal("fetch", fetchMock);
    await scoreNewLeads(getDb(), a, rec.data, rec.id);
    const user = userOf(fetchMock.mock.calls[0][1]);
    expect(user.instructions.join(" ")).toMatch(/competes with data\.icp\.company_name/);
    expect(user.data.icp.company_name).toBe("Linki");
  });
});

describe("match_mode broader", () => {
  it("is strictly more permissive than high precision", () => {
    for (const verdict of ["strong", "possible", "poor"]) for (const conf of ["high", "low"] as const) for (const score of [5, 50, 95]) {
      if (isQualified(verdict, conf, score, "high_precision")) expect(isQualified(verdict, conf, score, "broader")).toBe(true);
    }
    expect(isQualified("possible", "high", 20, "broader")).toBe(true);
    expect(isQualified("poor", "high", 90, "broader")).toBe(false);
    // Fit alone decides qualification now; warmth only sets priority.
    expect(isQualified("possible", "high", 60, "high_precision")).toBe(true);
    expect(isQualified("possible", "high", 50, "high_precision")).toBe(false);
  });

  it("keeps a below-threshold 'possible' lead that high precision drops", async () => {
    const precise = agent(90);
    const broad = agent(90);
    const strict = icpWith({ match_mode: "high_precision" });
    const loose = icpWith({ match_mode: "broader" });
    const p = lead(precise, { headline: "VP Sales at Acme" });
    const b = lead(broad, { headline: "VP Sales at Acme" });
    const fetchMock = vi.fn();
    scoreAll(fetchMock, { fit_score: 50, verdict: "possible" });
    vi.stubGlobal("fetch", fetchMock);
    await scoreNewLeads(getDb(), precise, strict.data, strict.id);
    await scoreNewLeads(getDb(), broad, loose.data, loose.id);
    expect(row(p).agent_status).toBe("disqualified");
    expect(row(b).agent_status).toBe("qualified");
  });
});

describe("targeting edits", () => {
  const icp = icpSchema.parse({ company_name: "Keep", offer: "Keep", personas: [{ name: "A", titles: ["CEO"] }, { name: "B", titles: ["CEO", "CTO"] }], company_sizes: ["11-50"], industries: ["Retail"], mandatory_keywords: ["AI"] });

  it("flattens roles, adds to the first persona and removes from all", () => {
    expect(roleTitles(icp)).toEqual(["CEO", "CTO"]);
    expect(addRole(icp, "CFO").personas[0].titles).toEqual(["CEO", "CFO"]);
    expect(roleTitles(removeRole(icp, "ceo"))).toEqual(["CTO"]);
    expect(addRole(icpSchema.parse({}), "Founder").personas[0]).toMatchObject({ name: "Target roles", titles: ["Founder"] });
  });

  it("maps size presets to stored values and older aliases", () => {
    expect(sizeLabel("11-50")).toBe("11–50 employees");
    expect(toggleSize(["11-50"], { value: "11-50 employees", label: "" })).toEqual([]);
    expect(toggleSize([], { value: "51-200 employees", label: "" })).toEqual(["51-200 employees"]);
  });

  it("clear all and regenerate touch targeting fields only", () => {
    const cleared = clearTargeting(icp);
    expect(roleTitles(cleared)).toEqual([]);
    expect(cleared).toMatchObject({ company_name: "Keep", offer: "Keep", industries: [], company_sizes: [], mandatory_keywords: [] });
    const draft = icpSchema.parse({ company_name: "Other", industries: ["Banking"], company_sizes: ["11-50"], personas: [{ name: "X", titles: ["CFO"] }] });
    const merged = applyDraftTargeting(icp, draft);
    expect(merged).toMatchObject({ company_name: "Keep", industries: ["Banking"], company_sizes: ["11-50 employees"], mandatory_keywords: ["AI"] });
    expect(roleTitles(merged)).toEqual(["CFO"]);
  });
});
