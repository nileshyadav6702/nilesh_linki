import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { runRetention, retentionRules, logRetentionDays } from "@/lib/maintenance/retention";

const WS = "ws-maint-retention";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, "maint-retention");
});

const count = (sql: string, ...args: unknown[]) => (getDb().prepare(sql).get(...args) as { n: number }).n;

describe("runRetention", () => {
  it("deletes old log rows in batches and keeps recent ones", async () => {
    const db = getDb();
    const ins = db.prepare("INSERT INTO logs (id, run_id, message, created_at) VALUES (?, NULL, 'x', datetime('now', ?))");
    db.transaction(() => {
      for (let i = 0; i < 25; i++) ins.run(`maint-old-${i}`, "-40 days");
      for (let i = 0; i < 3; i++) ins.run(`maint-new-${i}`, "-1 days");
    })();
    const r = await runRetention(db, { batchSize: 7, rules: retentionRules(30).filter((x) => x.table === "logs") });
    expect(r.deleted.logs).toBe(25);
    expect(r.truncated).toBe(false);
    expect(count("SELECT COUNT(*) n FROM logs WHERE id LIKE 'maint-%'")).toBe(3);
  });

  it("never touches sent business tables and keeps ai_usage inside 180 days", async () => {
    const db = getDb();
    db.prepare("INSERT INTO ai_usage (id, workspace_id, purpose, model, created_at) VALUES ('maint-u-old', ?, 'fit_score', 'm', datetime('now','-200 days'))").run(WS);
    db.prepare("INSERT INTO ai_usage (id, workspace_id, purpose, model, created_at) VALUES ('maint-u-new', ?, 'fit_score', 'm', datetime('now','-100 days'))").run(WS);
    const r = await runRetention(db);
    expect(r.errors).toEqual({});
    expect(count("SELECT COUNT(*) n FROM ai_usage WHERE id = 'maint-u-old'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM ai_usage WHERE id = 'maint-u-new'")).toBe(1);
    const tables = retentionRules().map((x) => x.table);
    for (const t of ["sent_messages", "email_replies", "linkedin_actions", "email_jobs", "enrichment_cache"]) expect(tables).not.toContain(t);
  });

  it("keeps the newest deliverability check per domain however old", async () => {
    const db = getDb();
    const ins = db.prepare("INSERT INTO deliverability_checks (id, workspace_id, domain, checked_at) VALUES (?, ?, ?, datetime('now', ?))");
    ins.run("maint-dc-1", WS, "old.test", "-400 days");
    ins.run("maint-dc-2", WS, "old.test", "-300 days");
    await runRetention(db, { rules: retentionRules().filter((x) => x.table === "deliverability_checks") });
    expect(count("SELECT COUNT(*) n FROM deliverability_checks WHERE domain = 'old.test'")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM deliverability_checks WHERE id = 'maint-dc-2'")).toBe(1);
  });

  it("stops at the time budget", async () => {
    const r = await runRetention(getDb(), { timeBudgetMs: 0, optimize: false });
    expect(r.truncated).toBe(true);
  });

  it("keeps logs unless LOG_RETENTION_DAYS is set", () => {
    const prev = process.env.LOG_RETENTION_DAYS;
    process.env.LOG_RETENTION_DAYS = "7";
    expect(logRetentionDays()).toBe(7);
    process.env.LOG_RETENTION_DAYS = "nonsense";
    expect(logRetentionDays()).toBeNull();
    delete process.env.LOG_RETENTION_DAYS;
    expect(logRetentionDays()).toBeNull();
    expect(retentionRules().some((r) => r.table === "logs")).toBe(false);
    if (prev === undefined) delete process.env.LOG_RETENTION_DAYS; else process.env.LOG_RETENTION_DAYS = prev;
  });
});
