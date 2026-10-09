import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createAgent } from "@/lib/agents/store";
import { adoptLookalikeLeads } from "@/lib/agents/lookalike-leads";
import type { LookalikeLead } from "@/lib/agents/lookalike-rules";

const WS = "ws-lookalike-leads";

beforeAll(() => {
  getDb().prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});

const lead = (over: Partial<LookalikeLead>): LookalikeLead => ({
  id: "https://www.linkedin.com/in/sunil-gupta/", name: "Sunil Gupta", title: "Chief Sales Officer", company: "Sammaan Capital", location: "Delhi, India",
  industry: null, photo: null, url: "https://www.linkedin.com/in/sunil-gupta/", match: 100, ...over,
});

describe("adoptLookalikeLeads", () => {
  it("adds the previewed matches as new leads in the agent's list, once", () => {
    const db = getDb();
    const agent = createAgent(WS, { name: "Lookalike test", mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "linkedin", exclude_first_degree: true });
    const leads = [
      lead({}),
      lead({ id: "urn:li:fs_salesProfile:(ABC,NAME_SEARCH,x)", name: "Asha Rao", url: "https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH,x" }),
    ];
    expect(adoptLookalikeLeads(db, agent, leads)).toBe(2);
    expect(adoptLookalikeLeads(db, agent, leads)).toBe(0);

    const rows = db.prepare("SELECT full_name, linkedin_url, sales_nav_url, agent_status, lead_source FROM targets WHERE agent_id = ? ORDER BY full_name").all(agent.id) as Array<Record<string, string | null>>;
    expect(rows).toEqual([
      { full_name: "Asha Rao", linkedin_url: null, sales_nav_url: "https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH,x", agent_status: "new", lead_source: "lookalike" },
      { full_name: "Sunil Gupta", linkedin_url: "https://www.linkedin.com/in/sunil-gupta", sales_nav_url: null, agent_status: "new", lead_source: "lookalike" },
    ]);
    const inList = (db.prepare("SELECT COUNT(*) n FROM list_targets WHERE list_id = ?").get(agent.list_id) as { n: number }).n;
    expect(inList).toBe(2);
    const signals = (db.prepare("SELECT COUNT(*) n FROM signals WHERE workspace_id = ? AND type = 'lookalike'").get(WS) as { n: number }).n;
    expect(signals).toBe(2);
  });
});
