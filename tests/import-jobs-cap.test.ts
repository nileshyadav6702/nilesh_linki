import { beforeAll, describe, expect, it, vi } from "vitest";

// 30 profiles on the first window, with more left in the search.
vi.mock("@/lib/linkedin/session", () => ({ getSessionContext: async () => ({}), markNeedsReauth: async () => {} }));
vi.mock("@/lib/linkedin/scraper", () => ({
  scrapeNavigatorUrl: async () => ({
    profiles: Array.from({ length: 30 }, (_, i) => ({ linkedinUrl: `https://www.linkedin.com/in/cap-${i}`, salesNavUrl: `https://www.linkedin.com/sales/lead/cap-${i}`, firstName: "Cap", lastName: String(i), fullName: `Cap ${i}` })),
    lastPage: 2, knownTotal: 500, exhausted: false,
  }),
}));

import { getDb } from "@/lib/db";
import { processScheduledImports, startImport } from "@/lib/import-jobs";

const WS = "ws-import-cap";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, cookies_json) VALUES ('acc-cap', ?, 'Cap', 'cap@x.io', 1, '{}')").run(WS);
  db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('list-cap', ?, 'Cap'), ('list-nocap', ?, 'No cap')").run(WS, WS);
});

describe("capped Sales Navigator imports", () => {
  it("keeps only `cap` contacts and does not chain another batch", async () => {
    const db = getDb();
    startImport(db, { listId: "list-cap", accountId: "acc-cap", salesNavUrl: "https://www.linkedin.com/sales/lists/people/1", cap: 10 });
    await processScheduledImports(db, { accountId: "acc-cap" });
    expect((db.prepare("SELECT COUNT(*) n FROM list_targets WHERE list_id = 'list-cap'").get() as { n: number }).n).toBe(10);
    const rows = db.prepare("SELECT status, imported FROM list_imports WHERE list_id = 'list-cap'").all();
    expect(rows).toEqual([{ status: "done", imported: 10 }]);
  });

  it("chains the remainder with the cap still left", async () => {
    const db = getDb();
    startImport(db, { listId: "list-nocap", accountId: "acc-cap", salesNavUrl: "https://www.linkedin.com/sales/lists/people/2", cap: 45 });
    await processScheduledImports(db, { accountId: "acc-cap" });
    const next = db.prepare("SELECT cap, status, start_page FROM list_imports WHERE list_id = 'list-nocap' AND status = 'scheduled'").get();
    expect(next).toEqual({ cap: 15, status: "scheduled", start_page: 3 });
  });
});
