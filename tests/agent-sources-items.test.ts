import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { configWithItems, itemKeys, sourceItems } from "@/lib/agents/source-items";
import { agentSeriesRange } from "@/lib/agents/analytics";

const WS = "ws-source-items";
const AGENT = "agent-source-items";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO agents (id, workspace_id, name) VALUES (?, ?, 'Items')").run(AGENT, WS);
  const lead = db.prepare("INSERT INTO targets (id, workspace_id, agent_id, full_name, created_at) VALUES (?, ?, ?, ?, ?)");
  const signal = db.prepare("INSERT INTO signals (id, workspace_id, target_id, agent_id, type, title, source, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))");
  for (let i = 0; i < 12; i++) {
    lead.run(`si-a${i}`, WS, AGENT, `A${i}`, "2026-10-05 10:00:00");
    signal.run(`sig-a${i}`, WS, `si-a${i}`, AGENT, "keyword_engagement", 'Reacted to a post about "outbound"', "agent:keyword_engagement");
  }
  lead.run("si-b", WS, AGENT, "B", "2026-10-07 09:00:00");
  signal.run("sig-b", WS, "si-b", AGENT, "keyword_engagement", 'Commented on a post about "Intent Data"', "agent:keyword_engagement");
  lead.run("si-c", WS, AGENT, "C", "2026-10-07 11:00:00");
  signal.run("sig-c", WS, "si-c", AGENT, "competitor_engagement", "Reacted to Lemlist's post", "agent:competitor_engagement");
});

describe("source items", () => {
  const topics = { agent_id: AGENT, source_type: "keyword_engagement", config_json: JSON.stringify({ keywords: ["outbound", "intent data", "cold email"] }) };

  it("counts each topic's and competitor's leads, with a volume tag", () => {
    expect(sourceItems(getDb(), topics)).toEqual([
      { key: "outbound", label: "outbound", sub: "Engagement & Interest", leads: 12, volume: "high" },
      { key: "intent data", label: "intent data", sub: "Engagement & Interest", leads: 1, volume: "low" },
      { key: "cold email", label: "cold email", sub: "Engagement & Interest", leads: 0, volume: "low" },
    ]);
    const competitors = { agent_id: AGENT, source_type: "competitor_engagement", config_json: JSON.stringify({ urls: ["https://www.linkedin.com/company/lemlist/"] }) };
    expect(sourceItems(getDb(), competitors)[0]).toMatchObject({ label: "Lemlist", sub: "Company competitor profile", leads: 1 });
  });

  it("narrows a source to one item (Launch now) or drops one (Remove signal)", () => {
    expect(itemKeys(topics)).toEqual(["outbound", "intent data", "cold email"]);
    expect(configWithItems(topics, (k) => k === "cold email")).toEqual({ keywords: ["cold email"] });
    expect(configWithItems(topics, (k) => k !== "outbound")).toEqual({ keywords: ["intent data", "cold email"] });
  });

  it("charts any date range, one point per day", () => {
    const pts = agentSeriesRange(getDb(), AGENT, "2026-10-04", "2026-10-07");
    expect(pts.map((p) => [p.day, p.found])).toEqual([["2026-10-04", 0], ["2026-10-05", 12], ["2026-10-06", 0], ["2026-10-07", 2]]);
  });
});
