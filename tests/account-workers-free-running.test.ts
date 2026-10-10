import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/linkedin/session", () => ({
  getSessionContext: vi.fn(async () => ({})), saveSessionState: vi.fn(async () => {}), dropStaleSession: vi.fn(), closeSession: vi.fn(async () => {}),
}));

import { getDb } from "@/lib/db";
import type { ActiveLease } from "@/lib/email/infrastructure";
import { accountsInFlight, startAccountWorkers, type AccountPhase } from "@/lib/linkedin/campaign/account-workers";

const lease: ActiveLease = { name: "linkedin-runner", owner: "test", token: 1, isHeld: () => true };

describe("free-running account workers", () => {
  it("a fast account starts again while a slow one is still working", async () => {
    let releaseSlow!: () => void;
    const slowDone = new Promise<void>((r) => { releaseSlow = r; });
    const runs: string[] = [];
    const phase: AccountPhase = {
      label: "Work", timeoutMs: 60_000,
      run: async (id) => { runs.push(id); if (id === "acc-slow") await slowDone; },
    };
    const opts = { accounts: ["acc-slow", "acc-fast"], phases: [phase], concurrency: 4 };

    expect((await startAccountWorkers(getDb(), lease, opts)).sort()).toEqual(["acc-fast", "acc-slow"]);
    await vi.waitFor(() => expect(accountsInFlight()).toEqual(["acc-slow"])); // fast finished, slow still going
    // Next pass: only the fast account is started again; the slow one isn't doubled up.
    expect(await startAccountWorkers(getDb(), lease, opts)).toEqual(["acc-fast"]);
    await vi.waitFor(() => expect(runs.filter((r) => r === "acc-fast")).toHaveLength(2));
    expect(runs.filter((r) => r === "acc-slow")).toHaveLength(1);
    releaseSlow();
    await vi.waitFor(() => expect(accountsInFlight()).toEqual([]));
  });
});
