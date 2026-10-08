import { describe, it, expect, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { execMigration, isBenignMigrationError, rebuildTable } from "@/lib/db/migrate";

/**
 * Migrations used to swallow every error, and the workflow_steps CHECK rebuild copied only
 * the original columns - writing NULL over email_subject/email_body and dropping every later
 * column on databases old enough to need it.
 */

describe("execMigration", () => {
  it("ignores re-run noise but rethrows real errors", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    execMigration(db, "ALTER TABLE t ADD COLUMN a TEXT");
    expect(() => execMigration(db, "ALTER TABLE t ADD COLUMN a TEXT")).not.toThrow(); // duplicate column
    expect(() => execMigration(db, "CREATE TABLE t (id TEXT)")).not.toThrow(); // already exists
    expect(() => execMigration(db, "ALTER TABLE missing ADD COLUMN a TEXT")).toThrow(/no such table/);
    expect(() => execMigration(db, "ALTER TABLE t ADD COLUMN b TEXT CHECK(")).toThrow();
    expect(isBenignMigrationError(new Error("duplicate column name: a"))).toBe(true);
    expect(isBenignMigrationError(new Error("database is locked"))).toBe(false);
  });

  it("logs, but does not fail boot on, a plain index over a column a legacy table lacks", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => execMigration(db, "CREATE INDEX IF NOT EXISTS idx_t_x ON t(x)")).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(() => execMigration(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_t_y ON t(y)")).toThrow();
  });
});

describe("rebuildTable", () => {
  it("drops a leftover temp table, copies shared columns, and restores foreign_keys", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT, gone TEXT); INSERT INTO t VALUES ('1', 'keep', 'x');");
    db.exec("CREATE TABLE t_new (junk TEXT)"); // left behind by a crashed earlier attempt
    rebuildTable(db, { table: "t", tempTable: "t_new", createTempSql: "CREATE TABLE t_new (id TEXT PRIMARY KEY, a TEXT NOT NULL, added TEXT DEFAULT 'd')" });
    expect(db.prepare("SELECT id, a, added FROM t").get()).toEqual({ id: "1", a: "keep", added: "d" });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rolls back to the old table when the copy fails", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT); INSERT INTO t VALUES ('1', NULL);");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => rebuildTable(db, { table: "t", tempTable: "t_new", createTempSql: "CREATE TABLE t_new (id TEXT PRIMARY KEY, a TEXT NOT NULL)" })).toThrow();
    err.mockRestore();
    expect(db.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't_new'").get()).toBeUndefined();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("workflow_steps step_type rebuild on an existing database", () => {
  it("widens the CHECK and keeps email_subject, email_body and later columns", async () => {
    const dbPath = path.join(os.tmpdir(), `linki-steps-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
    // 1. Current schema, then regress workflow_steps' CHECK to the pre-email shape with data.
    {
      vi.resetModules();
      process.env.LINKI_DB_PATH = dbPath;
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'workflow_steps'").get() as { sql: string }).sql;
      const legacy = sql
        .replace(/^CREATE TABLE\s+"?workflow_steps"?/i, "CREATE TABLE workflow_steps_legacy")
        .replace(/CHECK\s*\(\s*step_type\s+IN\s*\([^)]*\)\s*\)/i, "CHECK(step_type IN ('visit', 'connect', 'message', 'delay'))");
      db.pragma("foreign_keys = OFF");
      db.exec(`${legacy}; DROP TABLE workflow_steps; ALTER TABLE workflow_steps_legacy RENAME TO workflow_steps;`);
      db.exec("CREATE TABLE workflow_steps_new (junk TEXT)"); // leftover from a crashed rebuild
      db.pragma("foreign_keys = ON");
      db.prepare("INSERT INTO workflows (id, name) VALUES ('wf-legacy', 'Legacy')").run();
      db.prepare(`INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track, email_subject, email_body, ai_prompt, message_position)
        VALUES ('st-legacy', 'wf-legacy', 1, 'message', 'linkedin', 'Subject kept', 'Body kept', 'Prompt kept', 2)`).run();
      db.close();
    }
    // 2. Next boot runs the migration.
    {
      vi.resetModules();
      process.env.LINKI_DB_PATH = dbPath;
      const { getDb } = await import("@/lib/db");
      getDb().close();
    }
    // 3. Verify the migrated file.
    const check = new Database(dbPath);
    const sql = (check.prepare("SELECT sql FROM sqlite_master WHERE name = 'workflow_steps'").get() as { sql: string }).sql;
    for (const t of ["delay", "email", "sales_inmail"]) expect(sql).toContain(`'${t}'`);
    expect(check.prepare("SELECT email_subject, email_body, ai_prompt, message_position, track FROM workflow_steps WHERE id = 'st-legacy'").get())
      .toEqual({ email_subject: "Subject kept", email_body: "Body kept", ai_prompt: "Prompt kept", message_position: 2, track: "linkedin" });
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'workflow_steps_new'").get()).toBeUndefined();
    check.close();
    for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(dbPath + s); } catch { /* ignore */ } }
  });
});
