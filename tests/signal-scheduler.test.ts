import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import * as R from "@/lib/signals/schedule-rules";
import { gate, recordResult, respreadOverdue, syncUnits, unitKeys, type SourceUnit } from "@/lib/signals/scheduler";
import { cachedRead } from "@/lib/signals/read-cache";

const HOUR = 3_600_000;
const WS = "ws-sched";
const NOW = Date.parse("2026-10-07T10:00:00Z"); // a Wednesday

describe("schedule rules", () => {
  it("speeds productive items up and slows empty ones down, within 0.5×-3×", () => {
    expect(R.adaptiveInterval("competitor_engagement", null, 0)).toBe(8);
    expect(R.adaptiveInterval("competitor_engagement", 10, 0)).toBe(4);
    expect(R.adaptiveInterval("competitor_engagement", 5, 0)).toBe(6);
    expect(R.adaptiveInterval("competitor_engagement", 0, 2)).toBe(8);
    expect(R.adaptiveInterval("competitor_engagement", 0, 3)).toBe(12);
    expect(R.adaptiveInterval("competitor_engagement", 0, 9)).toBe(24);
    expect(R.adaptiveInterval("tech_stack", null, 0)).toBe(168);
  });
  it("jitters by ±15%", () => {
    expect(R.jittered(10, 0)).toBeCloseTo(8.5);
    expect(R.jittered(10, 0.999)).toBeCloseTo(11.5, 1);
  });
  it("backs off 15m, 30m, 1h… never past the cadence", () => {
    expect([1, 2, 3, 4].map((n) => R.backoffHours(n, 8))).toEqual([0.25, 0.5, 1, 2]);
    expect(R.backoffHours(10, 8)).toBe(8);
  });
  it("tells setup problems, budgets and pushback from passing errors", () => {
    expect(R.classifyError("Treg unreachable: fetch failed")).toBe("transient");
    expect(R.classifyError("Daily LinkedIn discovery budget reached (voyager_read)")).toBe("budget");
    expect(R.classifyError("Daily data budget of $5 reached")).toBe("budget");
    expect(R.classifyError("x", "VoyagerBlockedError")).toBe("blocked");
    expect(R.classifyError("Job-change tracking needs an authenticated LinkedIn account on the agent")).toBe("config");
    expect(R.classifyError("LinkedIn only lists profile visitors on Premium accounts")).toBe("config");
    expect(R.classifyError("Treg balance is empty. Top up at treg.to to resume lead discovery.")).toBe("config");
  });
  it("staggers first runs strongest intent first", () => {
    const starts = R.staggerStarts(["lookalike", "own_content_engagement", "keyword_engagement"], NOW, 3);
    expect(starts).toEqual([NOW + 6 * 60_000, NOW, NOW + 3 * 60_000]);
  });
  it("finds the next working window and paces the daily budget across it", () => {
    const w = { start: 9, end: 17, days: [1, 2, 3, 4, 5], timezone: "UTC" };
    expect(R.inWindow(w, new Date(NOW))).toBe(true);
    expect(R.nextWindowStart(w, new Date("2026-10-07T18:00:00Z")).toISOString()).toBe("2026-10-08T09:00:00.000Z");
    expect(R.nextWindowStart(w, new Date("2026-10-10T12:00:00Z")).toISOString()).toBe("2026-10-12T09:00:00.000Z"); // Sat → Mon
    expect(R.pacedAllowance(w, 120, new Date("2026-10-07T09:00:00Z"))).toBe(24); // start: 20% burst
    expect(R.pacedAllowance(w, 120, new Date("2026-10-07T13:00:00Z"))).toBe(84); // halfway + burst
    expect(R.pacedAllowance(w, 120, new Date("2026-10-07T20:00:00Z"))).toBe(0);
  });
  it("orders by intent, yield and how overdue", () => {
    expect(R.priority("own_content_engagement", null, 0, 6)).toBeGreaterThan(R.priority("lookalike", null, 0, 24));
    expect(R.priority("keyword_engagement", 10, 0, 12)).toBeGreaterThan(R.priority("keyword_engagement", 0, 0, 12));
  });
});

let seq = 0;
function agentWithSources(sources: Array<{ type: string; config?: object }>, opts: { account?: string | null; cap?: number } = {}) {
  const db = getDb();
  const agentId = `ag-sched-${++seq}`;
  db.prepare("INSERT INTO agents (id, workspace_id, name, status, linkedin_account_id, daily_lead_cap) VALUES (?, ?, ?, 'active', ?, ?)").run(agentId, WS, agentId, opts.account ?? null, opts.cap ?? 25);
  const ids = sources.map((s, i) => {
    const id = `${agentId}-src${i}`;
    db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, config_json) VALUES (?, ?, ?, ?, ?)").run(id, agentId, WS, s.type, JSON.stringify(s.config ?? {}));
    return id;
  });
  return { agentId, ids };
}
const unitsOf = (agentId: string) => getDb().prepare("SELECT * FROM source_units WHERE agent_id = ? ORDER BY next_run_at").all(agentId) as SourceUnit[];

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, 'Sched', 'sched')").run(WS);
  db.prepare(`INSERT OR IGNORE INTO accounts (id, name, email, workspace_id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days)
    VALUES ('acc-sched', 'S', 's@sched.test', ?, 1, 9, 17, 'UTC', '1,2,3,4,5')`).run(WS);
});

describe("signal scheduler", () => {
  it("gives page/topic items their own clock, staggered strongest first; on/off signals one", () => {
    const { agentId } = agentWithSources([
      { type: "keyword_engagement", config: { keywords: ["intent data", "sales ops"] } },
      { type: "own_content_engagement", config: { urls: ["https://www.linkedin.com/in/me"] } },
      { type: "tech_stack", config: { keywords: ["Intercom", "Segment"] } },
    ]);
    syncUnits(getDb(), NOW);
    const units = unitsOf(agentId);
    expect(units.map((u) => [u.source_type, u.item_key])).toEqual([
      ["own_content_engagement", "https://www.linkedin.com/in/me"],
      ["keyword_engagement", "intent data"],
      ["keyword_engagement", "sales ops"],
      ["tech_stack", "*"],
    ]);
    const times = units.map((u) => Date.parse(u.next_run_at));
    expect(times).toEqual([NOW, NOW + 3 * 60_000, NOW + 6 * 60_000, NOW + 9 * 60_000]);
    expect(unitKeys({ source_type: "tech_stack", config_json: "{\"keywords\":[\"A\"]}", agent_id: agentId })).toEqual(["*"]);
  });

  it("drops the clock of a removed item and keeps the others", () => {
    const { agentId, ids } = agentWithSources([{ type: "competitor_engagement", config: { urls: ["https://www.linkedin.com/company/a", "https://www.linkedin.com/company/b"] } }]);
    syncUnits(getDb(), NOW);
    const before = unitsOf(agentId).find((u) => u.item_key.endsWith("/a"))!;
    getDb().prepare("UPDATE agent_sources SET config_json = ? WHERE id = ?").run(JSON.stringify({ urls: ["https://www.linkedin.com/company/a"] }), ids[0]);
    syncUnits(getDb(), NOW + HOUR);
    const after = unitsOf(agentId);
    expect(after.map((u) => u.item_key)).toEqual(["https://www.linkedin.com/company/a"]);
    expect(after[0].next_run_at).toBe(before.next_run_at);
  });

  it("sets the next run from the result: cadence, backoff, attention, budget", () => {
    const db = getDb();
    const { agentId, ids } = agentWithSources([{ type: "funding" }]);
    syncUnits(db, NOW);
    const u = () => unitsOf(agentId)[0];
    recordResult(db, u(), { candidates: 5, ingested: 3, error: null }, NOW, () => 0.5);
    expect(Date.parse(u().next_run_at) - NOW).toBeCloseTo(R.adaptiveInterval("funding", 3, 0) * HOUR, -3);
    recordResult(db, u(), { candidates: 0, ingested: 0, error: "Treg unreachable: fetch failed" }, NOW, () => 0.5);
    expect(Date.parse(u().next_run_at) - NOW).toBe(0.25 * HOUR);
    recordResult(db, u(), { candidates: 0, ingested: 0, error: "Treg unreachable: fetch failed" }, NOW, () => 0.5);
    expect(Date.parse(u().next_run_at) - NOW).toBe(0.5 * HOUR);
    recordResult(db, u(), { candidates: 0, ingested: 0, error: "Daily data budget of $5 reached" }, NOW, () => 0);
    expect(u().next_run_at).toBe("2026-10-08T00:00:00.000Z");
    expect(u().state).toBe("waiting");
    recordResult(db, u(), { candidates: 0, ingested: 0, error: "Set up the agent's targeting first" }, NOW, () => 0);
    expect(u()).toMatchObject({ state: "attention", last_error: "Set up the agent's targeting first" });
    // Changing the setup wakes it up right away.
    db.prepare("UPDATE agent_sources SET config_json = ? WHERE id = ?").run(JSON.stringify({ feeds: ["https://example.com/feed"] }), ids[0]);
    syncUnits(db, NOW + HOUR);
    expect(u()).toMatchObject({ state: "active", last_error: null });
    expect(Date.parse(u().next_run_at)).toBe(NOW + HOUR);
  });

  it("spreads units that piled up while the worker was down", () => {
    const db = getDb();
    const { agentId } = agentWithSources([{ type: "keyword_engagement", config: { keywords: ["a1", "b2", "c3", "d4"] } }]);
    syncUnits(db, NOW - 10 * HOUR);
    expect(respreadOverdue(db, NOW)).toBeGreaterThanOrEqual(4);
    const times = unitsOf(agentId).map((u) => Date.parse(u.next_run_at));
    expect(times).toEqual([NOW, NOW + 5 * 60_000, NOW + 10 * 60_000, NOW + 15 * 60_000]);
  });

  it("pauses filler signals when the agent already has enough leads", () => {
    const db = getDb();
    const { agentId } = agentWithSources([{ type: "lookalike" }, { type: "funding" }], { cap: 1 });
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, full_name, created_at) VALUES (?, ?, ?, 'X', datetime('now'))").run(`t-${agentId}`, WS, agentId);
    syncUnits(db, NOW);
    const [look, fund] = ["lookalike", "funding"].map((t) => ({ ...unitsOf(agentId).find((u) => u.source_type === t)!, linkedin_account_id: null, daily_lead_cap: 1 }));
    const g = gate(db, look, Date.now(), () => 0);
    expect(g.ok).toBe(false);
    expect(gate(db, fund, Date.now(), () => 0).ok).toBe(true);
  });

  it("holds LinkedIn reads to the account's hours, needs an account, and spaces them", () => {
    const db = getDb();
    const { agentId } = agentWithSources([{ type: "profile_visitors" }, { type: "company_followers", config: { urls: ["https://www.linkedin.com/company/acme"] } }], { account: "acc-sched" });
    syncUnits(db, NOW);
    const units = unitsOf(agentId).map((u) => ({ ...u, linkedin_account_id: "acc-sched", daily_lead_cap: 25 }));
    const night = gate(db, units[0], Date.parse("2026-10-07T20:00:00Z"), () => 0);
    expect(night).toMatchObject({ ok: false, state: "waiting", until: Date.parse("2026-10-08T09:00:00Z") });
    expect(gate(db, { ...units[0], linkedin_account_id: null }, NOW, () => 0)).toMatchObject({ ok: false, state: "attention" });
    expect(gate(db, units[0], NOW, () => 0).ok).toBe(true);
    // Another read on this account 5 minutes ago: wait for the 10-minute spacing.
    db.prepare("UPDATE source_units SET last_run_at = ? WHERE id = ?").run(new Date(NOW - 5 * 60_000).toISOString(), units[1].id);
    expect(gate(db, units[0], NOW, () => 0)).toMatchObject({ ok: false, until: NOW + 5 * 60_000 });
  });
});

describe("shared reads", () => {
  it("serves a second agent's identical read from the cache", async () => {
    let calls = 0;
    const load = async () => { calls++; return [{ activityUrn: "urn:li:activity:1" }]; };
    const key = `test:posts:${Date.now()}`;
    expect(await cachedRead(key, load)).toEqual([{ activityUrn: "urn:li:activity:1" }]);
    expect(await cachedRead(key, load)).toEqual([{ activityUrn: "urn:li:activity:1" }]);
    expect(calls).toBe(1);
  });
});
