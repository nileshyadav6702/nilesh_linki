import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { listLeads, parseLeadsQuery } from "@/lib/agents/leads-query";

/** The Contacts page's use of the leads query: every workspace contact plus the extra filters. */

const WS = "ws-contacts-query";

function target(id: string, o: { agent?: string | null; score?: number | null; created?: string; reply?: string | null; replied?: boolean } = {}) {
  getDb().prepare(`INSERT INTO targets (id, workspace_id, full_name, linkedin_url, agent_id, agent_status, lead_score, intent_score, created_at, reply_kind, last_replied_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, WS, `Contact ${id}`, `https://www.linkedin.com/in/${id}`, o.agent ?? null, o.agent ? "qualified" : null,
    o.score ?? null, 0, o.created ?? "2026-03-10 09:00:00", o.reply ?? null, o.replied ? "2026-03-11" : null);
}

const ids = (params: Record<string, string>) => {
  const r = parseLeadsQuery({ scope: "all", status: "all", ...params });
  if (!r.ok) throw new Error(r.error);
  return listLeads(getDb(), WS, r.query).leads.map((l) => l.id as string).sort();
};

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO agents (id, workspace_id, name) VALUES (?, ?, ?)").run("cq-agent", WS, "Agent");
  db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES (?, ?, ?)").run("cq-list", WS, "Imported");
  target("cq-hot", { agent: "cq-agent", score: 82, reply: "positive", replied: true });
  target("cq-warm", { agent: "cq-agent", score: 60, created: "2026-01-05 10:00:00" });
  target("cq-cool", { score: 30 });
  target("cq-plain");
  db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)").run("cq-list", "cq-cool");
});

describe("contacts query", () => {
  it("scope=all includes contacts outside agents; the default stays agent-only", () => {
    expect(ids({})).toEqual(["cq-cool", "cq-hot", "cq-plain", "cq-warm"]);
    const r = parseLeadsQuery({ status: "all" });
    expect(r.ok && listLeads(getDb(), WS, r.query).leads.map((l) => l.id).sort()).toEqual(["cq-hot", "cq-warm"]);
  });

  it("filters by list, no list, score band, interested, replied and date range", () => {
    expect(ids({ list_id: "cq-list" })).toEqual(["cq-cool"]);
    expect(ids({ list_id: "none" })).toEqual(["cq-hot", "cq-plain", "cq-warm"]);
    expect(ids({ score_band: "3" })).toEqual(["cq-hot"]);
    expect(ids({ score_band: "2" })).toEqual(["cq-warm"]);
    expect(ids({ score_band: "1" })).toEqual(["cq-cool"]);
    expect(ids({ interested: "1" })).toEqual(["cq-hot"]);
    expect(ids({ replied: "1" })).toEqual(["cq-hot"]);
    expect(ids({ from: "2026-03-01", to: "2026-03-31" })).toEqual(["cq-cool", "cq-hot", "cq-plain"]);
    expect(ids({ to: "2026-02-01" })).toEqual(["cq-warm"]);
  });

  it("returns each contact's list and rejects bad values", () => {
    const r = parseLeadsQuery({ scope: "all", status: "all", list_id: "cq-list" });
    const row = r.ok ? listLeads(getDb(), WS, r.query).leads[0] : null;
    expect(row).toMatchObject({ list_name: "Imported", list_count: 1 });
    expect(parseLeadsQuery({ score_band: "9" }).ok).toBe(false);
    expect(ids({ from: "not-a-date" })).toHaveLength(4);
  });
});
