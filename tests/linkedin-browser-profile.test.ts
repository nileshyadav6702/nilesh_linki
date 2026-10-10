import { beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { getDb } from "@/lib/db";
import { browserProfile, contextOptions, loginProfileJson, newLoginContext } from "@/lib/linkedin/session";

const WS = "ws-browser-profile";
beforeAll(() => {
  delete process.env.LINKEDIN_BROWSER_TIMEZONE;
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, timezone) VALUES ('bp-old', ?, 'O', 'bpo@x.io', 'Asia/Kolkata'), ('bp-new', ?, 'N', 'bpn@x.io', 'Asia/Kolkata')").run(WS, WS);
});

describe("per-account browser fingerprint", () => {
  it("an account logged in before profiles keeps the exact fingerprint its session was born under", () => {
    const opts = contextOptions(undefined, undefined, browserProfile("bp-old"));
    expect(opts.viewport).toEqual({ width: 1920, height: 1080 });
    expect(opts.timezoneId).toBe("America/New_York");
  });

  it("a fresh login gets the account's own clock, stored only with the session it saves", async () => {
    let made: Record<string, unknown> = {};
    const fakeBrowser = { newContext: async (o: Record<string, unknown>) => { made = o; return {}; } } as unknown as Browser;
    const ctx = await newLoginContext(fakeBrowser, "bp-new");
    expect(made.timezoneId).toBe("Asia/Kolkata");
    // Not stored yet: a failed login must not change the fingerprint of the existing session.
    expect(browserProfile("bp-new").timezoneId).toBe("America/New_York");
    const json = loginProfileJson(ctx)!;
    getDb().prepare("UPDATE accounts SET browser_profile = COALESCE(?, browser_profile) WHERE id = 'bp-new'").run(json);
    expect(browserProfile("bp-new")).toEqual({ viewport: made.viewport, timezoneId: "Asia/Kolkata" });
  });
});
