import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

// The sync reads LinkedIn through the account's page: serve a stand-in connections page + API.
let browser: Browser;
let connections: Array<{ vanity: string; createdAt: number }> = [];
vi.mock("@/lib/linkedin/session", () => ({
  getSessionPage: async (): Promise<Page> => {
    const page = await browser.newPage();
    await page.route("https://www.linkedin.com/**", (r) => {
      if (r.request().url().includes("/voyager/api/relationships/dash/connections")) {
        const start = Number(new URL(r.request().url()).searchParams.get("start"));
        const rows = start ? [] : connections;
        return r.fulfill({ contentType: "application/json", body: JSON.stringify({ included: [
          ...rows.map((c, i) => ({ $type: "com.linkedin.voyager.dash.identity.profile.Profile", entityUrn: `urn:m:${i}`, publicIdentifier: c.vanity })),
          ...rows.map((c, i) => ({ $type: "com.linkedin.voyager.dash.relationships.Connection", connectedMember: `urn:m:${i}`, createdAt: c.createdAt })),
        ] }) });
      }
      return r.fulfill({ contentType: "text/html", body: `<html><body>${connections.length} connections</body></html>` });
    });
    return page;
  },
  saveSessionState: async () => {},
  markNeedsReauth: async () => {},
}));

import { getDb } from "@/lib/db";
import { syncAcceptedConnections } from "@/lib/linkedin/sync-accepted";

beforeAll(async () => {
  browser = await chromium.launch();
  const db = getDb();
  for (const ws of ["ws-sync-a", "ws-sync-b"]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('acc-sync-a', 'ws-sync-a', 'A', 'a@s.io', 1), ('acc-sync-b', 'ws-sync-b', 'B', 'b@s.io', 1)").run();
  const lead = db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, connection_requested_at, degree, connected_at) VALUES (?, ?, ?, ?, datetime('now','-1 day'), ?, ?)");
  lead.run("t-a-jane", "ws-sync-a", "Jane", "https://www.linkedin.com/in/jane-doe", null, null); // A invited, no trailing slash
  lead.run("t-b-jane", "ws-sync-b", "Jane (B)", "https://www.linkedin.com/in/jane-doe/", null, null); // same person, B's lead
  lead.run("t-b-bob", "ws-sync-b", "Bob", "https://www.linkedin.com/in/bob/", 1, "2026-10-01 10:00:00"); // B's real connection
  db.pragma("foreign_keys = OFF");
  const act = db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status) VALUES (?, ?, ?, 'r', 'tr', 's', ?, 'connect', ?)");
  act.run("la-a-jane", "k-a-jane", "acc-sync-a", "t-a-jane", "uncertain");
  act.run("la-b-jane", "k-b-jane", "acc-sync-b", "t-b-jane", "sent");
  act.run("la-b-bob", "k-b-bob", "acc-sync-b", "t-b-bob", "sent");
  db.pragma("foreign_keys = ON");
}, 60_000);
afterAll(async () => { await browser?.close(); });

const row = (id: string) => getDb().prepare("SELECT degree, connected_at FROM targets WHERE id = ?").get(id) as { degree: number | null; connected_at: string | null };

describe("accepted-connections sync is per account", () => {
  it("stamps only this account's invitees, settles an uncertain invite, and never un-marks another account's connections", async () => {
    connections = [{ vanity: "jane-doe", createdAt: Date.now() - 3_600_000 }];
    expect(await syncAcceptedConnections("acc-sync-a")).toBe(1);
    expect(row("t-a-jane").degree).toBe(1); // matched without a trailing slash
    expect(row("t-b-jane").degree).toBeNull(); // B invited this person too, but this is A's list
    expect(row("t-b-bob")).toMatchObject({ degree: 1 }); // a full pass of A's list must not wipe B's connection
    expect((getDb().prepare("SELECT status FROM linkedin_actions WHERE id = 'la-a-jane'").get() as { status: string }).status).toBe("sent");
  }, 60_000);
});
