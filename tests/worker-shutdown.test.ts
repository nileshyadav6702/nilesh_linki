import { describe, it, expect, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { WORKER_ID, acquireLease, type ActiveLease } from "@/lib/email/infrastructure";
import { accountLeaseHolder } from "@/lib/linkedin/account-lease";
import { claimAccount, runAccountWorkers, type AccountPhase } from "@/lib/linkedin/campaign/account-workers";
import { startLoop } from "@/lib/linkedin/campaign/loops";
import { _resetLifecycleForTests, isStopping, requestStop, runningLoopCount, waitForLoops } from "@/lib/runtime/lifecycle";
import { shutdownWorker, workerGraceMs } from "@/lib/worker/main";

/** Graceful worker shutdown: no new work starts, in-flight work finishes, leases are released. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  _resetLifecycleForTests();
  vi.restoreAllMocks();
});

describe("stop requests", () => {
  it("a leased loop finishes its pass in flight, wakes from its poll sleep and starts no new pass", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let passes = 0;
    let finished = 0;
    startLoop("Test loop", "test-loop-lease", async () => { passes++; await sleep(60); finished++; });
    await sleep(20); // first pass in flight
    expect(runningLoopCount()).toBe(1);
    requestStop();
    expect(await waitForLoops(2_000)).toBe(true); // did not wait out the 30s poll interval
    expect(passes).toBe(1);
    expect(finished).toBe(1);
  });

  it("stops starting account units and phases, lets the step in flight finish, and frees the accounts", async () => {
    const calls: string[] = [];
    const ps: AccountPhase[] = [0, 1, 2].map((i) => ({
      label: `p${i}`, timeoutMs: 5_000, run: async (id: string) => {
        calls.push(`${id}:${i}:start`);
        if (id === "stop-a" && i === 0) requestStop();
        await sleep(30);
        calls.push(`${id}:${i}:end`);
      },
    }));
    // The LinkedIn loop hands this wrapped lease to the pass (loops.ts).
    const lease: ActiveLease = { name: "linkedin-runner", owner: "t", token: 1, isHeld: () => !isStopping() };
    const outcomes = await runAccountWorkers(getDb(), lease, { accounts: ["stop-a", "stop-b"], phases: ps, concurrency: 1 });
    expect(calls).toEqual(["stop-a:0:start", "stop-a:0:end"]);
    expect(outcomes.get("stop-a")).toBe("lease_lost");
    expect(outcomes.has("stop-b")).toBe(false);
    expect(accountLeaseHolder("stop-a")).toBeNull();
  });
});

describe("shutdownWorker", () => {
  it("stops loops, closes sessions, releases this process's leases (loop + account) and closes the DB", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    startLoop("Shutdown loop", "shutdown-loop-lease", async () => { await sleep(10); });
    const release = claimAccount("shutdown-acct")!; // e.g. held by a unit when the signal came
    expect(accountLeaseHolder("shutdown-acct")).not.toBeNull();
    acquireLease("someone-elses-lease", "other-host:1:zzzz", 60);
    await sleep(5);

    const closeSessions = vi.fn(async () => ["acct-1"]);
    const closeDatabase = vi.fn();
    // Release the in-memory claim shortly after the stop, as a finishing unit would.
    setTimeout(release, 50);
    const report = await shutdownWorker(2_000, { closeSessions, closeDatabase });

    expect(report.loopsStopped).toBe(true);
    expect(report.accountsDrained).toBe(true);
    expect(report.sessionsClosed).toBe(1);
    expect(closeSessions).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    const left = getDb().prepare("SELECT name, owner_id FROM worker_leases").all() as Array<{ name: string; owner_id: string }>;
    expect(left.filter((l) => l.owner_id === WORKER_ID || l.owner_id.startsWith(`${WORKER_ID}:`))).toEqual([]);
    expect(left.map((l) => l.name)).toContain("someone-elses-lease");
    expect(accountLeaseHolder("shutdown-acct")).toBeNull();
  });

  it("gives up waiting after the grace period and still releases the account lease", async () => {
    const release = claimAccount("stuck-acct")!; // never released: an abandoned browser step
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = await shutdownWorker(100, { closeSessions: async () => [], closeDatabase: () => {} });
    expect(report.accountsDrained).toBe(false);
    expect(report.ms).toBeLessThan(1_500);
    expect(accountLeaseHolder("stuck-acct")).toBeNull();
    expect(warn).toHaveBeenCalled();
    release();
  });

  it("LINKI_WORKER_GRACE_MS defaults to 60s", () => {
    expect(workerGraceMs(undefined)).toBe(60_000);
    expect(workerGraceMs("5000")).toBe(5_000);
    expect(workerGraceMs("junk")).toBe(60_000);
  });
});
