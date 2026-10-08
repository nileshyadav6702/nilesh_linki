import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import type { ActiveLease } from "@/lib/email/infrastructure";
import type { AgentSource } from "@/lib/agents/store";
import { defaultAccountPhases, runAccountUnit } from "@/lib/linkedin/campaign/account-workers";
import { discoveryAccountIds, flagAccountlessDiscoverySources, runLinkedInDiscovery } from "@/lib/signals/linkedin-discovery";
import { pauseDiscovery } from "@/lib/linkedin/budget";

// LinkedIn signal discovery runs as the last phase of each account's worker unit, for that
// account's agents only, and stops starting sources the moment the runner lease is lost.

const ran: string[] = [];
let onRun: (source: AgentSource) => void = () => {};

vi.mock("@/lib/linkedin/session", () => ({
  getSessionContext: vi.fn(async () => ({})),
  saveSessionState: vi.fn(async () => {}),
}));
vi.mock("@/lib/linkedin/voyager", () => {
  class VoyagerBlockedError extends Error {}
  class VoyagerBudgetExceeded extends Error {}
  class VoyagerClient { requests = 0; async close() {} }
  return { VoyagerClient, VoyagerBlockedError, VoyagerBudgetExceeded };
});
vi.mock("@/lib/signals/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/signals/engine")>()),
  runSource: vi.fn(async (source: AgentSource) => {
    ran.push(source.id);
    onRun(source);
    return { candidates: 0, ingested: 0, filtered: 0, duplicates: 0, error: null };
  }),
}));

const WS = "ws-disc-acct";

function lease(held: () => boolean = () => true): ActiveLease {
  return { name: "linkedin-runner", owner: "test", token: 1, isHeld: held };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, 'Disc', 'disc-acct')").run(WS);
  for (const acc of ["li-a", "li-b"]) {
    db.prepare(`INSERT INTO accounts (id, name, email, workspace_id, is_authenticated, active_hours_start, active_hours_end, timezone, working_days)
      VALUES (?, ?, ?, ?, 1, 0, 24, 'UTC', '1,2,3,4,5,6,7')`).run(acc, acc, `${acc}@disc.test`, WS);
  }
  const agent = (id: string, account: string | null) =>
    db.prepare("INSERT INTO agents (id, workspace_id, name, status, linkedin_account_id) VALUES (?, ?, ?, 'active', ?)").run(id, WS, id, account);
  agent("ag-a", "li-a");
  agent("ag-b", "li-b");
  agent("ag-none", null);
  const source = (id: string, agentId: string) =>
    db.prepare("INSERT INTO agent_sources (id, agent_id, workspace_id, source_type) VALUES (?, ?, ?, 'competitor_engagement')").run(id, agentId, WS);
  source("src-a1", "ag-a");
  source("src-a2", "ag-a");
  source("src-b1", "ag-b");
  source("src-none", "ag-none");
}, 60_000);

beforeEach(() => { ran.length = 0; onRun = () => {}; });

describe("per-account LinkedIn signal discovery", () => {
  it("is the last phase of an account's worker unit and runs only that account's sources", async () => {
    const phases = defaultAccountPhases(getDb());
    const discovery = phases[phases.length - 1];
    expect(discovery.label).toBe("Signal discovery");

    expect(await runAccountUnit("li-a", lease(), [discovery])).toBe("done");
    expect(ran.sort()).toEqual(["src-a1", "src-a2"]);
  });

  it("stops between sources once the lease is lost", async () => {
    const discovery = defaultAccountPhases(getDb()).at(-1)!;
    let held = true;
    onRun = () => { held = false; };

    await runAccountUnit("li-a", lease(() => held), [discovery]);
    expect(ran).toHaveLength(1);
  });

  it("does not start at all without the lease", async () => {
    expect(await runLinkedInDiscovery(60_000, { accountId: "li-b", shouldStop: () => true })).toBe(0);
    expect(ran).toEqual([]);
  });

  it("schedules accounts with due discovery, except one paused after a 429/999", async () => {
    expect(discoveryAccountIds().sort()).toEqual(expect.arrayContaining(["li-a", "li-b"]));
    pauseDiscovery("li-b", "HTTP 999");
    expect(discoveryAccountIds()).not.toContain("li-b");
    expect(await runLinkedInDiscovery(60_000, { accountId: "li-b" })).toBe(0);
  });

  it("flags due sources whose agent has no LinkedIn account instead of leaving them due forever", async () => {
    expect(flagAccountlessDiscoverySources()).toBe(1);
    const row = getDb().prepare("SELECT last_error, next_run_at FROM agent_sources WHERE id = 'src-none'").get() as { last_error: string; next_run_at: string };
    expect(row.last_error).toMatch(/No LinkedIn account/);
    expect(row.next_run_at).toBeTruthy();
    expect(flagAccountlessDiscoverySources()).toBe(0);
  });
});
