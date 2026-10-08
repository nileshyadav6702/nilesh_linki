import { describe, it, expect, beforeAll } from "vitest";
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import { enrichNeedsDataLeads, NEEDS_DATA_MAX_ATTEMPTS } from "@/lib/linkedin/needs-data";
import { DISCOVERY_DAILY_LIMITS } from "@/lib/linkedin/budget";

/** Leads parked as needs_data get a few budgeted profile reads so they can be re-scored. */

const WS = "ws-needs-data";
const OTHER_WS = "ws-needs-data-other";
const ACCOUNT = "acct-needs-data";

beforeAll(() => {
  const db = getDb();
  for (const ws of [WS, OTHER_WS]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT INTO accounts (id, name, email, workspace_id, is_authenticated) VALUES (?, 'ND', 'nd@li.test', ?, 1)").run(ACCOUNT, WS);
  db.prepare("INSERT INTO agents (id, workspace_id, name, linkedin_account_id) VALUES ('agent-nd', ?, 'ND agent', ?)").run(WS, ACCOUNT);
  // An agent in ANOTHER workspace pointing at this account must not get its leads enriched.
  db.prepare("INSERT INTO agents (id, workspace_id, name, linkedin_account_id) VALUES ('agent-nd-x', ?, 'Other', ?)").run(OTHER_WS, ACCOUNT);
  const lead = db.prepare(`INSERT INTO targets (id, linkedin_url, sales_nav_url, full_name, workspace_id, agent_id, agent_status)
    VALUES (?, ?, ?, ?, ?, ?, 'needs_data')`);
  lead.run("nd-1", "https://www.linkedin.com/in/nd1", "https://www.linkedin.com/sales/lead/nd1", "Lead One", WS, "agent-nd");
  lead.run("nd-2", "https://www.linkedin.com/in/nd2", "https://www.linkedin.com/sales/lead/nd2", "Lead Two", WS, "agent-nd");
  lead.run("nd-x", "https://www.linkedin.com/in/ndx", "https://www.linkedin.com/sales/lead/ndx", "Foreign", OTHER_WS, "agent-nd-x");
});

const ctx = {} as BrowserContext;

describe("needs_data enrichment", () => {
  it("enriches only this workspace's leads, charges the profile_view budget, and stops after the attempt cap", async () => {
    const db = getDb();
    const seen: string[] = [];
    // The profile is genuinely empty: every read comes back with no headline/about.
    const deps = { getContext: async () => ctx, enrich: async (_c: BrowserContext, t: { id: string }) => { seen.push(t.id); return { status: "empty" as const }; }, delayMs: 0 };

    for (let pass = 0; pass < NEEDS_DATA_MAX_ATTEMPTS + 2; pass++) {
      await enrichNeedsDataLeads(deps, 5);
      // Skip the retry spacing so the next pass may try again.
      db.prepare("UPDATE targets SET profile_enrich_attempted_at = datetime('now', '-1 day') WHERE agent_status = 'needs_data'").run();
    }
    expect(seen).not.toContain("nd-x");
    expect(seen.filter((id) => id === "nd-1")).toHaveLength(NEEDS_DATA_MAX_ATTEMPTS);
    const row = db.prepare("SELECT agent_status, profile_enrich_attempts FROM targets WHERE id = 'nd-1'").get() as { agent_status: string; profile_enrich_attempts: number };
    expect(row).toEqual({ agent_status: "needs_data", profile_enrich_attempts: NEEDS_DATA_MAX_ATTEMPTS });
    const used = (db.prepare("SELECT COALESCE(SUM(count), 0) n FROM linkedin_usage WHERE account_id = ? AND kind = 'profile_view'").get(ACCOUNT) as { n: number }).n;
    expect(used).toBe(seen.length);
  });

  it("does nothing once the daily profile_view budget is spent", async () => {
    const db = getDb();
    db.prepare("INSERT INTO targets (id, linkedin_url, sales_nav_url, full_name, workspace_id, agent_id, agent_status) VALUES ('nd-3', 'https://www.linkedin.com/in/nd3', 'https://www.linkedin.com/sales/lead/nd3', 'Lead Three', ?, 'agent-nd', 'needs_data')").run(WS);
    db.prepare("UPDATE linkedin_usage SET count = ? WHERE account_id = ? AND kind = 'profile_view'").run(DISCOVERY_DAILY_LIMITS.profile_view, ACCOUNT);
    let calls = 0;
    await enrichNeedsDataLeads({ getContext: async () => ctx, enrich: async () => { calls++; return { status: "ok" }; }, delayMs: 0 });
    expect(calls).toBe(0);
  });
});
