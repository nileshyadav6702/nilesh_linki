import { describe, it, expect, beforeAll } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  getDailyImportCap, setDailyImportCap, importedToday, recoverStaleImports, hasActiveImport, processScheduledImports, DEFAULT_DAILY_CAP,
} from "@/lib/import-jobs";
import importCapHandler from "@/pages/api/settings/import-cap";

const WS_A = "ws-import-a";
const WS_B = "ws-import-b";
const USER = "user-import-1";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
const req = (ws: string, method: string, body?: unknown) =>
  ({ method, query: {}, body, headers: { "x-workspace-id": ws, "x-user-id": USER, "x-workspace-role": "admin" } }) as unknown as NextApiRequest;

let seq = 0;
function seedImport(ws: string, status: string, extra: { heartbeatAgo?: string | null; imported?: number; cancel?: number } = {}) {
  const db = getDb();
  const n = ++seq;
  const listId = `list-imp-${n}`;
  db.prepare("INSERT INTO lists (id, name, workspace_id) VALUES (?, ?, ?)").run(listId, `L${n}`, ws);
  const id = `imp-${n}`;
  // Queued rows default to a future day so they never become due in another test.
  db.prepare(`INSERT INTO list_imports (id, list_id, status, imported, cancel_requested, finished_at, started_at, scheduled_for)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'done' THEN datetime('now') END, datetime('now'), date('now', '+30 days'))`)
    .run(id, listId, status, extra.imported ?? 0, extra.cancel ?? 0, status);
  if (extra.heartbeatAgo !== undefined && extra.heartbeatAgo !== null) {
    db.prepare("UPDATE list_imports SET heartbeat_at = datetime('now', ?) WHERE id = ?").run(extra.heartbeatAgo, id);
  }
  return { id, listId };
}
const statusOf = (id: string) => (getDb().prepare("SELECT status FROM list_imports WHERE id = ?").get(id) as { status: string }).status;

beforeAll(() => {
  const db = getDb();
  for (const ws of [WS_A, WS_B]) db.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(USER, "import-user@example.com");
  for (const ws of [WS_A, WS_B]) db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(ws, USER);
});

describe("stale import recovery", () => {
  it("requeues a 'running' import whose worker died, and leaves a live one alone", () => {
    const dead = seedImport(WS_A, "running", { heartbeatAgo: "-2 hours" });
    const noBeat = seedImport(WS_A, "running");
    const live = seedImport(WS_A, "running", { heartbeatAgo: "-1 minutes" });
    const canceled = seedImport(WS_A, "running", { heartbeatAgo: "-2 hours", cancel: 1 });
    recoverStaleImports(getDb());
    expect(statusOf(dead.id)).toBe("scheduled");
    expect(statusOf(noBeat.id)).toBe("scheduled");
    expect(statusOf(live.id)).toBe("running");
    expect(statusOf(canceled.id)).toBe("canceled");
  });

  it("does not count a dead 'running' import as active for signal sources", () => {
    const db = getDb();
    const dead = seedImport(WS_A, "running", { heartbeatAgo: "-2 hours" });
    const live = seedImport(WS_A, "running", { heartbeatAgo: "-1 minutes" });
    const queued = seedImport(WS_A, "scheduled");
    expect(hasActiveImport(db, dead.listId)).toBe(false);
    expect(hasActiveImport(db, live.listId)).toBe(true);
    expect(hasActiveImport(db, queued.listId)).toBe(true);
  });

  it("resets its in-memory guard even when a pass throws", async () => {
    const db = getDb();
    // A due batch whose list was deleted: the pass cancels it. Run twice - a stuck guard
    // would make the second call a silent no-op.
    for (let i = 0; i < 2; i++) {
      const { id, listId } = seedImport(WS_A, "scheduled");
      db.prepare("UPDATE list_imports SET account_id = NULL, sales_nav_url = NULL, scheduled_for = date('now', '-1 day') WHERE id = ?").run(id);
      await processScheduledImports(db);
      expect(statusOf(id)).toBe("error");
      expect(hasActiveImport(db, listId)).toBe(false);
    }
  });
});

describe("per-workspace import cap", () => {
  it("one workspace's cap does not change another's", () => {
    const db = getDb();
    setDailyImportCap(db, 300, WS_A);
    expect(getDailyImportCap(db, WS_A)).toBe(300);
    expect(getDailyImportCap(db, WS_B)).toBe(DEFAULT_DAILY_CAP);
  });

  it("falls back to the legacy instance-wide value for workspaces that never set one", () => {
    const db = getDb();
    setDailyImportCap(db, 777);
    expect(getDailyImportCap(db, "ws-never-set")).toBe(777);
    expect(getDailyImportCap(db, WS_A)).toBe(300);
    db.prepare("DELETE FROM app_settings WHERE key = 'daily_import_cap'").run();
  });

  it("counts today's imports per workspace", () => {
    const db = getDb();
    const a0 = importedToday(db, WS_A);
    const b0 = importedToday(db, WS_B);
    seedImport(WS_A, "done", { imported: 40 });
    seedImport(WS_B, "done", { imported: 7 });
    expect(importedToday(db, WS_A)).toBe(a0 + 40);
    expect(importedToday(db, WS_B)).toBe(b0 + 7);
  });

  it("the settings API reads and writes the caller's workspace only", async () => {
    const put = mockRes();
    await importCapHandler(req(WS_B, "PUT", { cap: 120 }), put);
    expect(put.statusCode).toBe(200);
    expect(put.body).toEqual({ cap: 120 });

    const getB = mockRes();
    await importCapHandler(req(WS_B, "GET"), getB);
    expect((getB.body as { cap: number }).cap).toBe(120);
    const getA = mockRes();
    await importCapHandler(req(WS_A, "GET"), getA);
    expect((getA.body as { cap: number }).cap).toBe(300);

    const bad = mockRes();
    await importCapHandler(req(WS_B, "PUT", { cap: -1 }), bad);
    expect(bad.statusCode).toBe(400);
  });
});
