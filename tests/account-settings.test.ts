import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { buildDigest, digestText, localClock } from "@/lib/notifications/daily-digest";
import { displayName, userLanguage } from "@/lib/user-profile";
import handler from "@/pages/api/settings/account";

const WS = "ws-account";

function call(method: string, body?: unknown) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  handler({ method, body, query: {}, headers: { "x-workspace-id": WS, "x-user-id": "acct-user", "x-workspace-role": "member" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: { profile: Record<string, unknown>; error?: string } };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, 'Acme', ?)").run(WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('acct-user', 'nilesh@acme.test', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'acct-user', 'member')").run(WS);
});

describe("account settings", () => {
  it("saves name, language, timezone and the daily summary switch", () => {
    expect(call("GET").body.profile).toMatchObject({ email: "nilesh@acme.test", daily_digest: true, language: null });
    const res = call("PATCH", { first_name: " Nilesh ", last_name: "Yadav", language: "Spanish", timezone: "Asia/Calcutta", daily_digest: false });
    expect(res.body.profile).toMatchObject({ first_name: "Nilesh", last_name: "Yadav", language: "Spanish", timezone: "Asia/Calcutta", daily_digest: false });
    expect(userLanguage(getDb(), "acct-user")).toBe("Spanish");
    expect(displayName({ first_name: "Nilesh", last_name: "Yadav" })).toBe("Nilesh Yadav");
  });

  it("rejects unknown languages and timezones", () => {
    expect(call("PATCH", { language: "Klingon" }).statusCode).toBe(400);
    expect(call("PATCH", { timezone: "Mars/Olympus" }).statusCode).toBe(400);
  });
});

describe("daily digest", () => {
  it("knows the local date and hour in a timezone", () => {
    expect(localClock(new Date("2026-10-09T03:00:00Z"), "Asia/Calcutta")).toEqual({ date: "2026-10-09", hour: 8 });
    expect(localClock(new Date("2026-10-09T03:00:00Z"), "America/New_York")).toEqual({ date: "2026-10-08", hour: 23 });
  });

  it("summarises the last day's new leads, hottest first", () => {
    const db = getDb();
    db.prepare(`INSERT INTO targets (id, workspace_id, full_name, title, company, lead_score, created_at) VALUES
      ('dg-1', ?, 'Ann', 'VP Sales', 'Coram', 82, datetime('now', '-2 hours')),
      ('dg-2', ?, 'Bob', null, null, 40, datetime('now', '-3 hours')),
      ('dg-3', ?, 'Old', null, null, 95, datetime('now', '-3 days'))`).run(WS, WS, WS);
    const d = buildDigest(db, WS);
    expect(d).toMatchObject({ workspace: "Acme", newLeads: 2, hot: 1 });
    expect(d.top.map((l) => l.full_name)).toEqual(["Ann", "Bob"]);
    const mail = digestText(d, "https://app.example.com");
    expect(mail.subject).toBe("2 new leads in Acme · 1 hot");
    expect(mail.text).toContain("• Ann — VP Sales @ Coram  🔥");
    expect(mail.text).toContain("https://app.example.com/contacts");
  });
});
