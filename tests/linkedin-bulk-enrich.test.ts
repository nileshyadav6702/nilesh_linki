import { describe, it, expect, beforeAll } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";
import enrichHandler from "@/pages/api/lists/[id]/enrich";
import { bulkEnrichAccountIds, isBulkEnrichQueued, processBulkEnrichSlice } from "@/lib/linkedin/bulk-enrich";
import { accountsWithLinkedinWork, runAccountWorkers, type AccountPhase } from "@/lib/linkedin/campaign/account-workers";
import { DISCOVERY_DAILY_LIMITS } from "@/lib/linkedin/budget";
import type { ActiveLease } from "@/lib/email/infrastructure";

/** "Enrich this list" is queued and worked off by the account's own LinkedIn worker. */

const WS = "ws-bulk-enrich";
const USER = "user-bulk-enrich";
const ACCOUNT = "acct-bulk-enrich";
const LIST = "list-bulk-enrich";
const ctx = {} as BrowserContext;

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}

function post(listId: string) {
  return {
    method: "POST",
    query: { id: listId },
    body: { account_id: ACCOUNT },
    headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" },
  } as unknown as NextApiRequest;
}

const lease = (held = true): ActiveLease => ({ name: "linkedin-runner", owner: "t", token: 1, isHeld: () => held });

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(USER, "bulk-enrich@example.com");
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  db.prepare("INSERT INTO accounts (id, name, email, workspace_id, is_authenticated, cookies_json) VALUES (?, 'BE', 'be@li.test', ?, 1, 'x')").run(ACCOUNT, WS);
  db.prepare("INSERT INTO lists (id, name, workspace_id) VALUES (?, 'Bulk', ?)").run(LIST, WS);
  for (const n of [1, 2, 3]) {
    db.prepare("INSERT INTO targets (id, linkedin_url, sales_nav_url, full_name, workspace_id) VALUES (?, ?, ?, ?, ?)")
      .run(`be-${n}`, `https://www.linkedin.com/in/be${n}`, `https://www.linkedin.com/sales/lead/be${n}`, `Lead ${n}`, WS);
    db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)").run(LIST, `be-${n}`);
  }
});

describe("bulk list enrichment", () => {
  it("the API queues the list instead of driving the browser, and refuses a second request for it", async () => {
    const res = mockRes();
    await enrichHandler(post(LIST), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ started: true, profiles: 3 });
    expect(isBulkEnrichQueued(LIST)).toBe(true);
    expect(bulkEnrichAccountIds()).toContain(ACCOUNT);
    expect(await accountsWithLinkedinWork(getDb())).toContain(ACCOUNT);

    const again = mockRes();
    await enrichHandler(post(LIST), again);
    expect(again.statusCode).toBe(409);
  });

  it("does nothing once the lease is lost", async () => {
    let calls = 0;
    const r = await processBulkEnrichSlice(ACCOUNT, { getContext: async () => ctx, enrich: async () => { calls++; return { status: "ok" }; }, delayMs: 0, shouldStop: () => true });
    expect(r.stopped).toBe("lease");
    expect(calls).toBe(0);
    expect(isBulkEnrichQueued(LIST)).toBe(true);
  });

  it("is worked off in bounded slices by the account worker, reading each profile once", async () => {
    const db = getDb();
    const seen: string[] = [];
    const enrich = async (_c: BrowserContext, t: { id: string }) => {
      seen.push(t.id);
      // be-2 fails: it stays unenriched but must not be re-read forever.
      if (t.id === "be-2") return { status: "error" as const };
      db.prepare("UPDATE targets SET enriched_profile_at = datetime('now') WHERE id = ?").run(t.id);
      return { status: "ok" as const };
    };
    const { processBulkEnrichSlice: slice } = await import("@/lib/linkedin/bulk-enrich");
    const phases: AccountPhase[] = [{
      label: "Bulk list enrichment", timeoutMs: 5_000,
      run: (accountId, l) => slice(accountId, { getContext: async () => ctx, enrich, delayMs: 0, perSlice: 2, shouldStop: () => !l.isHeld() }),
    }];

    await runAccountWorkers(db, lease(), { accounts: [ACCOUNT], phases });
    expect(seen).toEqual(["be-1", "be-2"]);
    expect(isBulkEnrichQueued(LIST)).toBe(true);

    await runAccountWorkers(db, lease(), { accounts: [ACCOUNT], phases });
    expect(seen).toEqual(["be-1", "be-2", "be-3"]);
    expect(isBulkEnrichQueued(LIST)).toBe(false);

    await runAccountWorkers(db, lease(), { accounts: [ACCOUNT], phases });
    expect(seen).toHaveLength(3);
    const used = (db.prepare("SELECT COALESCE(SUM(count), 0) n FROM linkedin_usage WHERE account_id = ? AND kind = 'profile_view'").get(ACCOUNT) as { n: number }).n;
    expect(used).toBe(3);
  });

  it("stops at the daily profile_view budget and keeps the list queued for tomorrow", async () => {
    const db = getDb();
    db.prepare("UPDATE targets SET enriched_profile_at = NULL WHERE id IN ('be-1','be-3')").run();
    const res = mockRes();
    await enrichHandler(post(LIST), res);
    expect(res.statusCode).toBe(200);
    db.prepare("UPDATE linkedin_usage SET count = ? WHERE account_id = ? AND kind = 'profile_view'").run(DISCOVERY_DAILY_LIMITS.profile_view, ACCOUNT);
    let calls = 0;
    const r = await processBulkEnrichSlice(ACCOUNT, { getContext: async () => ctx, enrich: async () => { calls++; return { status: "ok" }; }, delayMs: 0 });
    expect(r.stopped).toBe("budget");
    expect(calls).toBe(0);
    expect(isBulkEnrichQueued(LIST)).toBe(true);
  });
});
