import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import handler, { type NotificationItem } from "@/pages/api/notifications";

const WS = "ws-notif-digest";
const USER = "user-notif-digest";
const headers = { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" };

function call(method: string, body?: unknown) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  handler({ method, body, query: {}, headers } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: { alerts: NotificationItem[]; items: NotificationItem[]; unread: number } };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'nd@x.io', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, timezone) VALUES ('nd-acc', ?, 'A', 'nd-acc@x.io', 'UTC')").run(WS);
  db.pragma("foreign_keys = OFF");
  const act = db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at) VALUES (?, ?, 'nd-acc', 'r', 't', 's', ?, ?, ?, datetime('now', ?))");
  // Yesterday: 3 invites + 1 message to 4 leads (one failed action ignored).
  act.run("nd1", "k1", "l1", "connect", "sent", "-1 day");
  act.run("nd2", "k2", "l2", "connect", "sent", "-1 day");
  act.run("nd3", "k3", "l3", "connect", "sent", "-1 day");
  act.run("nd4", "k4", "l4", "message", "sent", "-1 day");
  act.run("nd5", "k5", "l5", "connect", "failed", "-1 day");
  // Two days ago: 1 visit.
  act.run("nd6", "k6", "l6", "visit", "sent", "-2 days");
  db.pragma("foreign_keys = ON");
  // A signed-out account still running a campaign, a paused mailbox, an accepted invitation, an unsubscribe.
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, disconnected_at) VALUES ('nd-off', ?, 'Sam', 'nd-off@x.io', 0, datetime('now'))").run(WS);
  db.prepare("INSERT INTO runs (id, workspace_id, account_id, status) VALUES ('nd-run', ?, 'nd-off', 'running')").run(WS);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password, paused_at, paused_reason) VALUES ('nd-mb', ?, 'M', 'sam@nd.io', 's', 'u', 'p', datetime('now'), 'Auto-paused: 5 hard bounces')").run(WS);
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, connection_requested_at, connected_at) VALUES ('nd-acc-t', ?, 'A', datetime('now', '-3 days'), datetime('now'))").run(WS);
  db.prepare("INSERT INTO suppressions (id, workspace_id, kind, value, reason, source) VALUES ('nd-sup', ?, 'email', 'x@y.io', 'unsubscribe', 'list_unsubscribe')").run(WS);
});

describe("notifications", () => {
  it("summarise each day's outreach and mark it all read", () => {
    const first = call("GET").body;
    const campaign = first.items.filter((i) => i.kind === "campaign");
    expect(campaign.map((c) => [c.title, c.text])).toEqual([
      ["4 leads contacted", "Campaign completed : 1 message, 3 invites, 0 visits"],
      ["1 lead contacted", "Campaign completed : 0 messages, 0 invites, 1 visit"],
    ]);
    expect(first.alerts.map((a) => a.title)).toEqual(expect.arrayContaining(["Reconnect Sam on LinkedIn", "Sending paused for sam@nd.io"]));
    expect(first.items.map((i) => i.title)).toEqual(expect.arrayContaining(["1 invitation accepted", "1 person unsubscribed"]));
    expect(first.unread).toBe(first.alerts.length + first.items.length);
    expect(call("POST", { action: "read_all" }).statusCode).toBe(200);
    const after = call("GET").body;
    expect(after.unread).toBe(0);
    expect(after.items.every((i) => !i.unread)).toBe(true);
  });
});
