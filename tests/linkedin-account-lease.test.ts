import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { acquireLease, type ActiveLease } from "@/lib/email/infrastructure";
import { acquireAccountLease, accountLeaseHolder, accountLeaseName } from "@/lib/linkedin/account-lease";
import { claimAccount, isAccountBusy, runAccountUnit, type AccountPhase } from "@/lib/linkedin/campaign/account-workers";

/**
 * Web (LINKI_ROLE=web) and worker (LINKI_ROLE=worker) are separate processes, so the in-memory
 * account claim cannot exclude across them. The DB lease `linkedin-account:<id>` does. A second
 * process is simulated by a lease holder with a different owner id.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runnerLease: ActiveLease = { name: "linkedin-runner", owner: "test", token: 1, isHeld: () => true };

function phases(calls: string[], ms = 5): AccountPhase[] {
  return [0, 1].map((i) => ({ label: `p${i}`, timeoutMs: 5_000, run: async (id: string) => { calls.push(`${id}:${i}`); await sleep(ms); } }));
}

/** Another process holding the account, as the worker or web server would. */
function otherProcessHolds(accountId: string, owner = "other-host:4242:abcd1234:ffff0000") {
  const handle = acquireLease(accountLeaseName(accountId), owner, 60);
  expect(handle).not.toBeNull();
  return handle!;
}

describe("DB account lease", () => {
  it("excludes a second owner until the first releases it", () => {
    const web = acquireAccountLease("lease-x", { owner: "web-host:1:aaaa" })!;
    expect(web.isHeld()).toBe(true);
    expect(acquireAccountLease("lease-x", { owner: "worker-host:2:bbbb" })).toBeNull();
    expect(accountLeaseHolder("lease-x")).toBe("web-host:1:aaaa");
    web.release();
    expect(web.isHeld()).toBe(false);
    expect(accountLeaseHolder("lease-x")).toBeNull();
    const worker = acquireAccountLease("lease-x", { owner: "worker-host:2:bbbb" })!;
    expect(worker.isHeld()).toBe(true);
    worker.release();
  });

  it("a crashed holder's lease expires and the takeover fences it out", () => {
    const dead = acquireAccountLease("lease-crash", { owner: "dead:1:aaaa" })!;
    getDb().prepare("UPDATE worker_leases SET expires_at = ? WHERE name = ?").run(new Date(Date.now() - 1000).toISOString(), accountLeaseName("lease-crash"));
    const next = acquireAccountLease("lease-crash", { owner: "alive:2:bbbb" })!;
    expect(next).not.toBeNull();
    expect(dead.isHeld()).toBe(false);
    // The dead holder's late release must not free the new holder's lease.
    dead.release();
    expect(next.isHeld()).toBe(true);
    next.release();
  });

  it("two holders in ONE process are excluded too (each acquisition has its own owner)", () => {
    const a = acquireAccountLease("lease-same")!;
    expect(acquireAccountLease("lease-same")).toBeNull();
    a.release();
  });
});

describe("web-side claimAccount vs the worker's account unit", () => {
  it("claimAccount fails while the worker process holds the account", () => {
    const worker = otherProcessHolds("cross-1");
    expect(claimAccount("cross-1")).toBeNull();
    expect(isAccountBusy("cross-1")).toBe(false); // nothing was left claimed in this process
    getDb().prepare("DELETE FROM worker_leases WHERE name = ? AND owner_id = ?").run(worker.name, worker.owner);
    const release = claimAccount("cross-1");
    expect(release).not.toBeNull();
    release!();
  });

  it("the worker's unit skips an account the web process holds, and runs once it is released", async () => {
    const calls: string[] = [];
    const web = otherProcessHolds("cross-2", "web-host:7:cccc:dddd");
    expect(await runAccountUnit("cross-2", runnerLease, phases(calls))).toBe("busy");
    expect(calls).toEqual([]);
    getDb().prepare("DELETE FROM worker_leases WHERE name = ? AND owner_id = ?").run(web.name, web.owner);
    expect(await runAccountUnit("cross-2", runnerLease, phases(calls))).toBe("done");
    expect(calls).toEqual(["cross-2:0", "cross-2:1"]);
  });

  it("a running unit holds the DB lease (other process locked out) and frees it when the unit ends", async () => {
    const calls: string[] = [];
    let seenFromOtherProcess: unknown = "unset";
    const ps: AccountPhase[] = [{
      label: "probe", timeoutMs: 5_000, run: async (id) => {
        calls.push(id);
        seenFromOtherProcess = acquireAccountLease(id, { owner: "web-host:9:eeee" });
      },
    }];
    expect(await runAccountUnit("cross-3", runnerLease, ps)).toBe("done");
    expect(seenFromOtherProcess).toBeNull();
    expect(accountLeaseHolder("cross-3")).toBeNull();
  });

  it("a unit whose account lease is taken over stops before its next phase", async () => {
    const calls: string[] = [];
    const ps: AccountPhase[] = [
      {
        label: "steal", timeoutMs: 5_000, run: async (id) => {
          calls.push("steal");
          getDb().prepare("UPDATE worker_leases SET owner_id = 'thief:1:x', token = token + 1 WHERE name = ?").run(accountLeaseName(id));
        },
      },
      { label: "after", timeoutMs: 5_000, run: async () => { calls.push("after"); } },
    ];
    expect(await runAccountUnit("cross-4", runnerLease, ps)).toBe("lease_lost");
    expect(calls).toEqual(["steal"]);
    // The thief's lease is untouched by the unit's release.
    expect(accountLeaseHolder("cross-4")).toBe("thief:1:x");
  });
});
