import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { insightsReport, parsePeriod, periodDays, sourceName } from "@/lib/insights/report";

const WS = "ws-insights";
const P = { from: "2026-10-01", to: "2026-10-07" };

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO workflows (id, workspace_id, name) VALUES (?, ?, ?)").run("ins-wf", WS, "Campaign");
  db.prepare("INSERT INTO agents (id, workspace_id, name, status, workflow_id) VALUES (?, ?, ?, 'active', ?)").run("ins-a1", WS, "VP Sales", "ins-wf");
  db.prepare("INSERT INTO agents (id, workspace_id, name, status) VALUES (?, ?, ?, 'paused')").run("ins-a2", WS, "Founders");
  const step = db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, connect_note) VALUES (?, 'ins-wf', ?, ?, 'linkedin', ?)");
  step.run("ins-s1", 1, "connect", "Hi {{first_name}}");
  step.run("ins-s2", 2, "delay", null);
  step.run("ins-s3", 3, "message", null);
  db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type, config_json) VALUES (?, 'ins-a1', ?, 'competitor_engagement', ?)")
    .run("ins-src", WS, JSON.stringify({ urls: ["https://www.linkedin.com/company/clay-run/", "https://www.linkedin.com/company/lemlist/"] }));
  const lead = db.prepare(`INSERT INTO targets (id, workspace_id, agent_id, full_name, created_at, connection_requested_at, connected_at, message_sent_at, last_replied_at, reply_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Found, invited with a note, accepted, messaged, replied with interest.
  lead.run("ins-t1", WS, "ins-a1", "Ann", "2026-10-02 09:00:00", "2026-10-02 10:00:00", "2026-10-03 08:00:00", "2026-10-04 08:00:00", "2026-10-05 08:00:00", "positive");
  // Found and invited only.
  lead.run("ins-t2", WS, "ins-a1", "Bob", "2026-10-03 09:00:00", "2026-10-03 10:00:00", null, null, null, null);
  // Found before the period: counts as contacted inside it, not as found.
  lead.run("ins-t3", WS, "ins-a2", "Cy", "2026-09-20 09:00:00", null, null, "2026-10-06 09:00:00", null, null);
  const action = db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, step_id, target_id, type, status, updated_at) VALUES (?, ?, 'acc', ?, ?, ?, 'sent', ?)");
  action.run("ins-la1", "k1", "ins-s1", "ins-t1", "connect", "2026-10-02 10:00:00");
  action.run("ins-la2", "k2", "ins-s3", "ins-t1", "message", "2026-10-04 08:00:00");
  action.run("ins-la3", "k3", "ins-s1", "ins-t2", "connect", "2026-10-03 10:00:00");
  const sig = db.prepare("INSERT INTO signals (id, workspace_id, target_id, agent_id, type, title, score, occurred_at) VALUES (?, ?, ?, 'ins-a1', ?, ?, 50, '2026-10-02')");
  sig.run("ins-g1", WS, "ins-t1", "competitor_engagement", "Reacted to Clay Run's post");
  sig.run("ins-g2", WS, "ins-t2", "funding", "Raised a Series A");
});

describe("insights report", () => {
  it("counts each lead once per metric, on the day it happened", () => {
    const r = insightsReport(getDb(), WS, { period: P });
    expect(r.overview).toEqual({ found: 2, contacted: 3, messaged: 3, replied: 1, interested: 1 });
    expect(r.series).toHaveLength(7);
    expect(r.series.find((d) => d.day === "2026-10-05")).toMatchObject({ replied: 1, interested: 1 });
    expect(r.agents.map((a) => [a.name, a.found, a.contacted, a.replied])).toEqual([["VP Sales", 2, 2, 1], ["Founders", 0, 1, 0]]);
  });

  it("names lead sources from signals and keeps configured pages", () => {
    const r = insightsReport(getDb(), WS, { period: P });
    expect(r.sources.find((s) => s.name === "Clay Run")).toMatchObject({ category: "competitor", leads: 1, replied: 1, interested: 1 });
    expect(r.sources.find((s) => s.name === "Recently raised funds")).toMatchObject({ category: "buying_events", leads: 1 });
    expect(r.sources.find((s) => s.name === "/company/lemlist")).toMatchObject({ leads: 0 });
  });

  it("breaks one agent's campaign down by step, crediting replies to the last step sent", () => {
    const r = insightsReport(getDb(), WS, { agentId: "ins-a1", period: P });
    expect(r.agents).toEqual([]);
    const [li] = r.channels;
    expect(li).toMatchObject({ channel: "linkedin", sent: 2, replied: 1 });
    expect(li.steps.map((s) => [s.n, s.label, s.sent, s.accepted, s.replied])).toEqual([[1, "Connection request", 2, 1, 0], [2, "LinkedIn message", 1, null, 1]]);
  });

  it("parses periods and names", () => {
    expect(parsePeriod("2026-10-07", "2026-10-01")).toEqual(P);
    expect(periodDays(parsePeriod("2026-01-01", "2026-12-31"))).toHaveLength(365);
    expect(sourceName("keyword_engagement", 'Reacted to a post about "buying intent"')).toBe("buying intent");
    expect(sourceName("job_change", "Just hired")).toBe("Recently changed jobs");
  });
});
