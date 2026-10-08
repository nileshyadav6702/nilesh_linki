import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import type { ActiveLease } from "@/lib/email/infrastructure";
import {
  accountConcurrency, isAccountBusy, runAccountUnit, runAccountWorkers, type AccountPhase,
} from "@/lib/linkedin/campaign/account-workers";

/** Per-account LinkedIn workers: parallel across accounts, strictly sequential within one. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeLease(held: () => boolean = () => true): ActiveLease {
  return { name: "linkedin-runner", owner: "test", token: 1, isHeld: held };
}

/** Phases that record overall and per-account concurrency, taking `ms(account)` each. */
function recordingPhases(ms: (accountId: string) => number, count = 2) {
  const stats = { active: 0, maxActive: 0, perAccount: new Map<string, number>(), maxPerAccount: 0, finished: [] as string[], calls: [] as string[] };
  const phases: AccountPhase[] = Array.from({ length: count }, (_, i) => ({
    label: `phase-${i}`,
    timeoutMs: 5_000,
    run: async (accountId: string) => {
      stats.calls.push(`${accountId}:${i}`);
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      const mine = (stats.perAccount.get(accountId) ?? 0) + 1;
      stats.perAccount.set(accountId, mine);
      stats.maxPerAccount = Math.max(stats.maxPerAccount, mine);
      await sleep(ms(accountId));
      stats.perAccount.set(accountId, (stats.perAccount.get(accountId) ?? 1) - 1);
      stats.active--;
      if (i === count - 1) stats.finished.push(accountId);
    },
  }));
  return { phases, stats };
}

describe("LINKEDIN_ACCOUNT_CONCURRENCY", () => {
  it("defaults to 4, rejects junk and clamps to 16", () => {
    expect(accountConcurrency(undefined)).toBe(4);
    expect(accountConcurrency("abc")).toBe(4);
    expect(accountConcurrency("0")).toBe(4);
    expect(accountConcurrency("2")).toBe(2);
    expect(accountConcurrency("99")).toBe(16);
  });
});

describe("account workers", () => {
  it("never runs more accounts at once than the concurrency cap", async () => {
    const { phases, stats } = recordingPhases(() => 15);
    const accounts = ["cap-a", "cap-b", "cap-c", "cap-d", "cap-e"];
    const outcomes = await runAccountWorkers(getDb(), fakeLease(), { accounts, phases, concurrency: 2 });
    expect(stats.maxActive).toBe(2);
    expect(stats.calls).toHaveLength(accounts.length * phases.length);
    expect(Array.from(outcomes.values()).every((o) => o === "done")).toBe(true);
  });

  it("runs one account's phases strictly in sequence, and an overlapping pass skips a busy account", async () => {
    const { phases, stats } = recordingPhases(() => 20, 3);
    const lease = fakeLease();
    const [first, second] = await Promise.all([
      runAccountWorkers(getDb(), lease, { accounts: ["seq-a"], phases, concurrency: 4 }),
      (async () => { await sleep(5); return runAccountWorkers(getDb(), lease, { accounts: ["seq-a"], phases, concurrency: 4 }); })(),
    ]);
    expect(stats.maxPerAccount).toBe(1);
    expect(stats.calls).toEqual(["seq-a:0", "seq-a:1", "seq-a:2"]);
    expect(first.get("seq-a")).toBe("done");
    expect(second.get("seq-a")).toBe("busy");
  });

  it("a slow account does not hold up another account's due work", async () => {
    const { phases, stats } = recordingPhases((id) => (id === "slow" ? 150 : 5));
    const started = Date.now();
    let fastDoneAt = 0;
    const watcher = (async () => {
      while (!stats.finished.includes("fast")) await sleep(2);
      fastDoneAt = Date.now() - started;
    })();
    await runAccountWorkers(getDb(), fakeLease(), { accounts: ["slow", "fast"], phases, concurrency: 2 });
    await watcher;
    expect(stats.finished).toEqual(["fast", "slow"]);
    expect(fastDoneAt).toBeLessThan(150);
  });

  it("a timed-out phase ends the account's unit and keeps the account busy until the work really stops", async () => {
    let resolveStuck!: () => void;
    const later: string[] = [];
    const phases: AccountPhase[] = [
      { label: "stuck", timeoutMs: 20, run: () => new Promise<void>((r) => { resolveStuck = r; }) },
      { label: "next", timeoutMs: 1_000, run: async (id) => { later.push(id); } },
    ];
    expect(await runAccountUnit("hung", fakeLease(), phases)).toBe("timed_out");
    expect(later).toEqual([]);
    expect(isAccountBusy("hung")).toBe(true);
    expect(await runAccountUnit("hung", fakeLease(), phases)).toBe("busy");
    resolveStuck();
    await sleep(0);
    expect(isAccountBusy("hung")).toBe(false);
  });

  it("stops mutating once the lease is lost: no further phases and no further accounts", async () => {
    let held = true;
    const calls: string[] = [];
    const phases: AccountPhase[] = [
      { label: "first", timeoutMs: 1_000, run: async (id) => { calls.push(`${id}:first`); held = false; } },
      { label: "second", timeoutMs: 1_000, run: async (id) => { calls.push(`${id}:second`); } },
    ];
    const outcomes = await runAccountWorkers(getDb(), fakeLease(() => held), { accounts: ["lease-a", "lease-b"], phases, concurrency: 1 });
    expect(calls).toEqual(["lease-a:first"]);
    expect(outcomes.get("lease-a")).toBe("lease_lost");
    expect(outcomes.has("lease-b")).toBe(false);
  });
});
