import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { EMAIL_ATTEMPT_PROVIDER } from "@/lib/agents/loop";
import { computeOutreach, leadFacets, listLeads, parseLeadsQuery, type LeadsQuery } from "@/lib/agents/leads-query";

/** The Leads tab query: allowlisted params, each filter's SQL, sort orders, facets and outreach detail. */

const WS = "ws-leads-query";
const AGENT = "agent-lq";
const OTHER_AGENT = "agent-lq-2";
const WF = "wf-lq";

interface Seed { id: string; status?: string; score?: number; created?: string; email?: string | null; phone?: string | null; apollo?: boolean; invited?: boolean; connected?: boolean; messaged?: boolean; inmail?: boolean; replied?: boolean; agent?: string }

function target(s: Seed) {
  getDb().prepare(`INSERT INTO targets (id, workspace_id, full_name, linkedin_url, agent_id, agent_status, lead_score, intent_score, created_at, email, phone, apollo_enriched_at,
      connection_requested_at, connected_at, message_sent_at, inmail_sent_at, last_replied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    s.id, WS, `Lead ${s.id}`, `https://www.linkedin.com/in/${s.id}`, s.agent ?? AGENT, s.status ?? "qualified", s.score ?? 50, 0, s.created ?? "2026-01-01 00:00:00",
    s.email ?? null, s.phone ?? null, s.apollo ? "2026-01-02" : null,
    s.invited ? "2026-01-03" : null, s.connected ? "2026-01-04" : null, s.messaged ? "2026-01-05" : null, s.inmail ? "2026-01-05" : null, s.replied ? "2026-01-06" : null);
}

function signal(id: string, targetId: string, type: string, at: string) {
  getDb().prepare("INSERT INTO signals (id, workspace_id, target_id, type, title, occurred_at) VALUES (?,?,?,?,?,?)").run(id, WS, targetId, type, `Signal ${id}`, at);
}

function q(params: Record<string, string>): LeadsQuery {
  const r = parseLeadsQuery({ agent_id: AGENT, status: "all", ...params });
  if (!r.ok) throw new Error(r.error);
  return r.query;
}
const ids = (params: Record<string, string>) => listLeads(getDb(), WS, q(params)).leads.map((l) => l.id as string).sort();

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Leads query", "leads-query");
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(WF, "Seq", WS);
  const step = db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, ?, ?, ?)");
  step.run("lq-s1", WF, 1, "connect", "linkedin");
  step.run("lq-s2", WF, 2, "delay", "linkedin");
  step.run("lq-s3", WF, 3, "message", "linkedin");
  step.run("lq-s4", WF, 1, "email", "email");
  db.prepare("INSERT INTO agents (id, workspace_id, name, workflow_id) VALUES (?, ?, ?, ?)").run(AGENT, WS, "Agent", WF);
  db.prepare("INSERT INTO agents (id, workspace_id, name) VALUES (?, ?, ?)").run(OTHER_AGENT, WS, "Other");

  target({ id: "lq-drafted", status: "drafted", score: 90, created: "2026-01-05 00:00:00", email: "Ann@x.com" });
  target({ id: "lq-approved", status: "approved", score: 70, created: "2026-01-04 00:00:00", phone: "+1 555" });
  target({ id: "lq-enrolled", status: "enrolled", score: 60, created: "2026-01-03 00:00:00", invited: true, apollo: true });
  target({ id: "lq-replied", status: "enrolled", score: 40, created: "2026-01-02 00:00:00", invited: true, connected: true, messaged: true, replied: true, email: "bob@x.com" });
  target({ id: "lq-needs", status: "needs_data", score: 30, created: "2026-01-01 00:00:00" });
  target({ id: "lq-dq", status: "disqualified", score: 20, created: "2025-12-31 00:00:00", inmail: true });
  target({ id: "lq-skipped", status: "skipped", score: 10, created: "2025-12-30 00:00:00", email: "unsub@x.com" });
  target({ id: "lq-pending-q", status: "qualified", score: 55, created: "2025-12-29 00:00:00" });
  target({ id: "lq-other", status: "drafted", agent: OTHER_AGENT });

  signal("lq-sig1", "lq-drafted", "competitor_engagement", "2026-02-01");
  signal("lq-sig2", "lq-drafted", "hiring", "2026-02-02");
  signal("lq-sig3", "lq-approved", "competitor_engagement", "2026-03-01");
  signal("lq-sig4", "lq-needs", "funding", "2026-01-15");

  db.prepare("INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, body) VALUES (?,?,?,?,?,?)").run("lq-aq", WS, AGENT, "lq-pending-q", "email", "Hi");
  db.prepare("INSERT INTO enrichment_cache (identity_key, provider) VALUES (?, ?)").run("target:lq-needs", EMAIL_ATTEMPT_PROVIDER);
  db.prepare("INSERT INTO suppressions (id, workspace_id, kind, value) VALUES (?,?,?,?)").run("lq-sup", WS, "email", "unsub@x.com");
  db.pragma("foreign_keys = OFF");
  db.prepare("INSERT INTO sent_messages (id, workspace_id, job_id, email_account_id, target_id, recipient, subject, message_id) VALUES (?,?,?,?,?,?,?,?)")
    .run("lq-sm", WS, "lq-job", "lq-acct", "lq-pending-q", "p@x.com", "Hi", "<m@x>");
  db.pragma("foreign_keys = ON");

  db.prepare("INSERT INTO runs (id, workflow_id, status) VALUES (?, ?, 'running')").run("lq-run", WF);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run("lq-rp", "lq-run", "lq-enrolled");
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', 2)").run("lq-rt", "lq-rp");
});

describe("parseLeadsQuery", () => {
  it("rejects values outside the allowlists", () => {
    for (const bad of [{ status: "'; DROP TABLE targets;--" }, { step: "x" }, { approval: "maybe" }, { email_enrich: "y" }, { phone_enrich: "z" }, { sort: "name" }, { signal_type: "nope" }, { verdict: "great" }]) {
      expect(parseLeadsQuery(bad).ok).toBe(false);
    }
  });
  it("defaults to active leads ranked by score and clamps paging", () => {
    const r = parseLeadsQuery({ limit: "5000", offset: "-3" });
    expect(r.ok && r.query).toMatchObject({ status: "active", sort: "score_desc", limit: 100, offset: 0, facets: false });
    const legacy = parseLeadsQuery({ status: "enrolled", facets: "1" });
    expect(legacy.ok && legacy.query).toMatchObject({ status: "enrolled", facets: true });
  });
});

describe("listLeads filters", () => {
  it("scopes to the agent; status all includes rejected leads, the default hides them", () => {
    expect(ids({})).toHaveLength(8);
    expect(ids({ status: "" })).not.toContain("lq-dq");
    expect(listLeads(getDb(), WS, { ...q({}), status: "active" }).total).toBe(6);
  });
  it("filters by status", () => {
    expect(ids({ status: "drafted" })).toEqual(["lq-drafted"]);
    expect(ids({ status: "scheduled" })).toEqual(["lq-approved"]);
    expect(ids({ status: "in_sequence" })).toEqual(["lq-enrolled"]);
    expect(ids({ status: "replied" })).toEqual(["lq-replied"]);
    expect(ids({ status: "needs_data" })).toEqual(["lq-needs"]);
    expect(ids({ status: "disqualified" })).toEqual(["lq-dq"]);
    expect(ids({ status: "skipped" })).toEqual(["lq-skipped"]);
  });
  it("filters by campaign step", () => {
    expect(ids({ step: "invitation_sent" })).toEqual(["lq-enrolled"]);
    expect(ids({ step: "invitation_accepted" })).toEqual(["lq-replied"]);
    expect(ids({ step: "message_sent" })).toEqual(["lq-replied"]);
    expect(ids({ step: "inmail_sent" })).toEqual(["lq-dq"]);
    expect(ids({ step: "email_sent" })).toEqual(["lq-pending-q"]);
    expect(ids({ step: "replied" })).toEqual(["lq-replied"]);
    expect(ids({ step: "not_contacted" })).toEqual(["lq-approved", "lq-drafted", "lq-needs", "lq-skipped"]);
  });
  it("filters by approval", () => {
    expect(ids({ approval: "pending" })).toEqual(["lq-drafted", "lq-pending-q"]);
    expect(ids({ approval: "approved" })).toEqual(["lq-approved", "lq-enrolled", "lq-replied"]);
    expect(ids({ approval: "rejected" })).toEqual(["lq-skipped"]);
  });
  it("filters by email and phone enrichment", () => {
    expect(ids({ email_enrich: "found" })).toEqual(["lq-drafted", "lq-replied"]);
    expect(ids({ email_enrich: "not_found" })).toEqual(["lq-enrolled", "lq-needs"]);
    expect(ids({ email_enrich: "not_enriched" })).toEqual(["lq-approved", "lq-dq", "lq-pending-q"]);
    expect(ids({ email_enrich: "unsubscribed" })).toEqual(["lq-skipped"]);
    expect(ids({ phone_enrich: "found" })).toEqual(["lq-approved"]);
    expect(ids({ phone_enrich: "not_found" })).toEqual(["lq-enrolled"]);
    expect(ids({ phone_enrich: "not_enriched" })).toHaveLength(6);
  });
  it("filters by signal type and search text", () => {
    expect(ids({ signal_type: "competitor_engagement" })).toEqual(["lq-approved", "lq-drafted"]);
    expect(ids({ q: "lq-repl" })).toEqual(["lq-replied"]);
  });
});

describe("listLeads sort orders", () => {
  const order = (sort: string) => listLeads(getDb(), WS, q({ sort })).leads.map((l) => l.id);
  it("sorts by score, recency and latest signal", () => {
    expect(order("score_desc").slice(0, 3)).toEqual(["lq-drafted", "lq-approved", "lq-enrolled"]);
    expect(order("score_asc").slice(0, 2)).toEqual(["lq-skipped", "lq-dq"]);
    expect(order("newest")[0]).toBe("lq-drafted");
    expect(order("signal_desc").slice(0, 3)).toEqual(["lq-approved", "lq-drafted", "lq-needs"]);
    expect(order("signal_asc").slice(0, 3)).toEqual(["lq-needs", "lq-drafted", "lq-approved"]);
  });
});

describe("leadFacets", () => {
  it("counts each option with the other filters applied", () => {
    const f = leadFacets(getDb(), WS, q({}));
    expect(f.status).toMatchObject({ all: 8, drafted: 1, scheduled: 1, in_sequence: 1, replied: 1, qualified: 1, needs_data: 1, disqualified: 1, skipped: 1 });
    expect(f.step).toMatchObject({ all: 8, invitation_sent: 1, invitation_accepted: 1, email_sent: 1, not_contacted: 4 });
    expect(f.signal).toEqual([{ type: "competitor_engagement", count: 2 }, { type: "funding", count: 1 }, { type: "hiring", count: 1 }]);
    // Status counts ignore the status filter itself but honour the signal filter.
    const g = leadFacets(getDb(), WS, q({ status: "drafted", signal_type: "competitor_engagement" }));
    expect(g.status).toMatchObject({ all: 2, drafted: 1, scheduled: 1 });
    expect(g.signal).toEqual([{ type: "competitor_engagement", count: 1 }, { type: "hiring", count: 1 }]);
  });
  it("is returned by listLeads when asked", () => {
    expect(listLeads(getDb(), WS, q({ facets: "1" })).facets?.status.all).toBe(8);
    expect(listLeads(getDb(), WS, q({})).facets).toBeUndefined();
  });
});

describe("outreach detail", () => {
  const steps = ["connect", "delay", "message", "email"];
  it("names the previous and next action steps, skipping delays", () => {
    const o = computeOutreach(steps, { track: "linkedin", state: "in_progress", current_step: 1, next_step_at: null }, null);
    expect(o.prev).toEqual({ type: "connect", order: 1, label: "Invitation" });
    expect(o.next).toEqual({ type: "message", order: 2, label: "Message" });
    expect(o.waiting).toBe("Waiting for LinkedIn invitation acceptance.");
  });
  it("marks an accepted invitation and waits for the scheduled time", () => {
    const now = Date.parse("2026-05-01T00:00:00Z");
    const o = computeOutreach(steps, { track: "linkedin", state: "in_progress", current_step: 2, next_step_at: "2026-05-02 09:30:00" }, "2026-04-30", now);
    expect(o.prev).toMatchObject({ type: "connect", accepted: true });
    expect(o.waiting).toBe("Waiting until 2026-05-02 09:30 UTC");
    expect(computeOutreach(steps, { track: "linkedin", state: "in_progress", current_step: 2, next_step_at: "2026-04-01 00:00:00" }, "x", now).waiting).toBeNull();
  });
  it("has no next step once the track is finished", () => {
    const o = computeOutreach(steps, { track: "linkedin", state: "completed", current_step: 4, next_step_at: null }, null);
    expect(o.prev).toMatchObject({ type: "email", order: 3 });
    expect(o.next).toBeNull();
    expect(o.waiting).toBeNull();
    expect(computeOutreach(steps, { track: "linkedin", state: "in_progress", current_step: 0, next_step_at: null }, null)).toMatchObject({ prev: null, next: { type: "connect", order: 1 } });
  });
  it("is attached to listed leads from their run track", () => {
    const lead = listLeads(getDb(), WS, q({ status: "in_sequence" })).leads[0] as { outreach: { prev: { type: string }; next: { type: string }; waiting: string }; outreach_step: string };
    expect(lead.outreach.prev.type).toBe("connect");
    expect(lead.outreach.next.type).toBe("message");
    expect(lead.outreach.waiting).toMatch(/invitation acceptance/);
    expect(lead.outreach_step).toBe("message");
  });
});
