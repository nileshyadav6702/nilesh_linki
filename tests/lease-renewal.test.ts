import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { acquireLease, renewLease, holdsLease, withLease, acquireWorkerLease } from "@/lib/email/infrastructure";

/**
 * Worker leases had a 45s TTL but guarded passes that run for minutes, so a second process
 * could take the lease mid-pass and drive the same LinkedIn session. Leases now renew on a
 * heartbeat while work runs and carry a fencing token that changes when they change hands.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lease fencing", () => {
  it("a second holder cannot take a live lease", () => {
    const a = acquireLease("fence-live", "owner-A", 60);
    expect(a).not.toBeNull();
    expect(acquireLease("fence-live", "owner-B", 60)).toBeNull();
    expect(acquireWorkerLease("fence-live", "owner-B", 60)).toBe(false);
    // Re-acquiring your own lease keeps the same generation.
    expect(acquireLease("fence-live", "owner-A", 60)?.token).toBe(a!.token);
  });

  it("a takeover after expiry bumps the token and fences out the old holder", () => {
    const a = acquireLease("fence-expire", "owner-A", 60)!;
    getDb().prepare("UPDATE worker_leases SET expires_at = ? WHERE name = 'fence-expire'").run(new Date(Date.now() - 1000).toISOString());
    expect(holdsLease(a)).toBe(false);
    const b = acquireLease("fence-expire", "owner-B", 60)!;
    expect(b.token).toBe(a.token + 1);
    expect(holdsLease(b)).toBe(true);
    // The old holder can neither renew nor pass the fencing check.
    expect(renewLease(a, 60)).toBe(false);
    expect(holdsLease(a)).toBe(false);
    expect(acquireLease("fence-expire", "owner-A", 60)).toBeNull();
  });
});

describe("withLease renewal", () => {
  it("keeps renewing while the work runs, so the lease outlives its TTL", async () => {
    let heldMidway = false;
    let otherGotIt = true;
    const r = await withLease("renew-loop", async (lease) => {
      await sleep(1500); // longer than the 1s TTL
      heldMidway = lease.isHeld();
      otherGotIt = acquireLease("renew-loop", "intruder", 1) !== null;
      return "done";
    }, { owner: "renewer", ttlSeconds: 1, renewEveryMs: 200 });
    expect(r).toEqual({ acquired: true, value: "done" });
    expect(heldMidway).toBe(true);
    expect(otherGotIt).toBe(false);
  });

  it("does not run the work when another live holder has the lease", async () => {
    acquireLease("renew-busy", "someone-else", 60);
    let ran = false;
    const r = await withLease("renew-busy", async () => { ran = true; }, { owner: "me" });
    expect(r.acquired).toBe(false);
    expect(ran).toBe(false);
  });

  it("reports a takeover to the running work via isHeld()", async () => {
    const seen: boolean[] = [];
    await withLease("renew-stolen", async (lease) => {
      seen.push(lease.isHeld());
      // Simulate a stall long enough for another process to take over.
      getDb().prepare("UPDATE worker_leases SET owner_id = 'thief', token = token + 1 WHERE name = 'renew-stolen'").run();
      await sleep(300);
      seen.push(lease.isHeld());
    }, { owner: "victim", ttlSeconds: 60, renewEveryMs: 100 });
    expect(seen).toEqual([true, false]);
  });
});
