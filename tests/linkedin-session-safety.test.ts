import { describe, it, expect } from "vitest";
import type { ActiveLease } from "@/lib/email/infrastructure";
import { claimAccount, isAccountBusy, runAccountUnit } from "@/lib/linkedin/campaign/account-workers";
import { noDataError } from "@/lib/linkedin/scraper";

/** Guards against the two things that got accounts rate-limited: parallel session use and false logouts. */

const lease: ActiveLease = { name: "linkedin-runner", owner: "test", token: 1, isHeld: () => true };

describe("claimAccount (wizard preview vs the runner)", () => {
  it("keeps the runner off an account the preview holds, until released", async () => {
    const release = claimAccount("acc-preview")!;
    expect(release).toBeTypeOf("function");
    expect(isAccountBusy("acc-preview")).toBe(true);

    let ran = false;
    const outcome = await runAccountUnit("acc-preview", lease, [{ label: "p", timeoutMs: 1000, run: async () => { ran = true; } }]);
    expect(outcome).toBe("busy");
    expect(ran).toBe(false);

    release();
    await Promise.resolve();
    expect(isAccountBusy("acc-preview")).toBe(false);
  });

  it("refuses to claim an account a worker unit is driving", async () => {
    let finish!: () => void;
    const unit = runAccountUnit("acc-busy", lease, [{ label: "p", timeoutMs: 1000, run: () => new Promise<void>((r) => { finish = r; }) }]);
    expect(claimAccount("acc-busy")).toBeNull();
    finish();
    await unit;
    const release = claimAccount("acc-busy");
    expect(release).not.toBeNull();
    release!();
  });
});

describe("noDataError (Sales Navigator gave no data)", () => {
  it("asks for re-authentication only when LinkedIn redirected to login/checkpoint/authwall", () => {
    for (const url of ["https://www.linkedin.com/login?session_redirect=x", "https://www.linkedin.com/checkpoint/challengesV2/abc", "https://www.linkedin.com/authwall?trk=x"]) {
      expect(noDataError(url, "saved search").message).toMatch(/re-authentication/);
    }
  });

  it("keeps the session when the account simply has no Sales Navigator or the page was slow", () => {
    for (const url of ["https://www.linkedin.com/sales/search/people?query=x", "https://www.linkedin.com/premium/products/?upsellOrderOrigin=sales", "https://www.linkedin.com/feed/"]) {
      const msg = noDataError(url, "saved search").message;
      // The import job and profile-scrape route log the account out on these words.
      expect(msg).not.toMatch(/re-authentication|No data intercepted/i);
      expect(msg).toMatch(/session was kept/);
    }
  });
});
