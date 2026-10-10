import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { applyDailyVariation } from "@/lib/linkedin/actions";

const WS = "ws-daily-variation";
const limits = () => ({ daily_connection_limit: 20, daily_message_limit: 50, daily_visit_limit: 150, daily_inmail_limit: 15, timezone: "UTC" });

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email) VALUES ('dv-new', ?, 'N', 'dvn@x.io'), ('dv-old', ?, 'O', 'dvo@x.io')").run(WS, WS);
  db.pragma("foreign_keys = OFF");
  db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at) VALUES ('dv-a', 'dv-k', 'dv-old', 'r', 't', 's', 'x', 'connect', 'sent', datetime('now', '-60 days'))").run();
  db.pragma("foreign_keys = ON");
});

describe("daily caps", () => {
  it("an established account sends 80–100% of its caps, the same share all day", () => {
    const a = limits(); const b = limits();
    const day = new Date("2026-10-12T09:00:00Z");
    applyDailyVariation(getDb(), "dv-old", a, day);
    applyDailyVariation(getDb(), "dv-old", b, new Date("2026-10-12T17:00:00Z"));
    expect(a).toEqual(b);
    expect(a.daily_connection_limit).toBeGreaterThanOrEqual(16);
    expect(a.daily_connection_limit).toBeLessThanOrEqual(20);
    // Some other day differs (over a fortnight, not every day equal).
    const seen = new Set<number>();
    for (let d = 1; d <= 14; d++) { const l = limits(); applyDailyVariation(getDb(), "dv-old", l, new Date(Date.UTC(2026, 9, d, 12))); seen.add(l.daily_message_limit); }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("an account new to automation starts at under half its caps; a cap of 1 stays 1", () => {
    const l = limits();
    const factor = applyDailyVariation(getDb(), "dv-new", l);
    expect(factor).toBeLessThanOrEqual(0.4);
    expect(l.daily_connection_limit).toBeLessThanOrEqual(8);
    const one = { ...limits(), daily_message_limit: 1 };
    applyDailyVariation(getDb(), "dv-new", one);
    expect(one.daily_message_limit).toBe(1);
  });
});
