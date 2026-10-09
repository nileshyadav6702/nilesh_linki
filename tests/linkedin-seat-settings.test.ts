import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { applyWeeklyQuota, linkedinActionsThisWeek } from "@/lib/linkedin/actions";
import { localWeekStartUtc } from "@/lib/outreach/schedule";
import { parseSeatSettings, weeklyToDaily } from "@/lib/linkedin/quotas";
import { addMessages, listThreads, upsertThread } from "@/lib/inbox/store";

const aiJson = vi.fn();
vi.mock("@/lib/ai/client", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/client")>()), aiJson: (...a: unknown[]) => aiJson(...a) }));
const { draftPendingReplies } = await import("@/lib/inbox/ai-draft");
const { default: handler } = await import("@/pages/api/accounts/[id]/index");

const WS = "ws-seat";
const ACC = "acc-seat";

function call(method: string, body?: unknown) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return Promise.resolve(handler({ method, body, query: { id: ACC }, headers: { "x-workspace-id": WS, "x-user-id": "seat-user", "x-workspace-role": "owner" } } as unknown as NextApiRequest, res as unknown as NextApiResponse))
    .then(() => res as { statusCode: number; body: Record<string, unknown> });
}

/** A sent action `daysAgo` days back (foreign keys off: no run/track rows needed). */
function action(type: string, at: Date) {
  const db = getDb();
  db.pragma("foreign_keys = OFF");
  db.prepare(`INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, created_at)
    VALUES (?, ?, ?, 'r', 't', 's', 'x', ?, 'sent', ?)`).run(randomUUID(), randomUUID(), ACC, type, at.toISOString().replace("T", " ").slice(0, 19));
  db.pragma("foreign_keys = ON");
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('seat-user', 'seat@x.test', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'seat-user', 'owner')").run(WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated, timezone, working_days) VALUES (?, ?, 'Seat', 'seat@x.io', 1, 'Asia/Kolkata', '1,2,3,4,5')").run(ACC, WS);
});

describe("weekly quotas", () => {
  it("weeks start Monday 00:00 on the seat's calendar", () => {
    // Wed 8 Oct 2026, 10:00 in Kolkata → Monday 5 Oct 00:00 IST = Sun 4 Oct 18:30 UTC.
    expect(localWeekStartUtc("Asia/Kolkata", new Date("2026-10-08T04:30:00Z"))).toBe("2026-10-04 18:30:00");
  });

  it("spreads a weekly quota over the active days, under the daily ceiling", () => {
    expect(weeklyToDaily("daily_connection_limit", 80, 5)).toBe(16);
    expect(weeklyToDaily("daily_visit_limit", 700, 3)).toBe(150);
  });

  it("caps today at what the week has left", () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) action("connect", now);
    expect(linkedinActionsThisWeek(getDb(), ACC, "connect", "Asia/Kolkata")).toBeGreaterThanOrEqual(3);
    const limits = { daily_connection_limit: 20, daily_message_limit: 30, daily_visit_limit: 40, weekly_connection_limit: 4, weekly_message_limit: null, weekly_visit_limit: null, timezone: "Asia/Kolkata" };
    applyWeeklyQuota(getDb(), ACC, limits, { connect: 3, message: 0, visit: 0 });
    // 3 sent today, 1 left this week → today's cap is 4: one more invitation, then stop.
    expect(limits).toMatchObject({ daily_connection_limit: 4, daily_message_limit: 30, daily_visit_limit: 40 });
  });
});

describe("seat settings API", () => {
  it("validates and saves country, weekly quotas, inbox and AI reply settings", async () => {
    expect(parseSeatSettings({ country: "india" })).toEqual({ error: "Country must be a two-letter code" });
    expect(parseSeatSettings({ booking_url: "calendly" })).toMatchObject({ error: expect.stringContaining("https://") });
    const r = await call("PUT", { country: "in", weekly_connection_limit: 80, weekly_message_limit: 5000, inbox_contacts_only: true, ai_draft_replies: true, booking_url: "https://cal.com/me", reply_instructions: "Be brief" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ country: "IN", weekly_connection_limit: 80, weekly_message_limit: 700, daily_connection_limit: 16, daily_message_limit: 140, inbox_contacts_only: 1, ai_draft_replies: 1, booking_url: "https://cal.com/me" });
    expect((r.body.usage_week as { connect: number }).connect).toBeGreaterThanOrEqual(3);
  });
});

describe("inbox filter and AI reply drafts", () => {
  it("hides strangers' conversations and drafts a reply to a contact's new message", async () => {
    const db = getDb();
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url) VALUES ('seat-t1', ?, 'Known Person', 'https://www.linkedin.com/in/known')").run(WS);
    const known = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: ACC, externalId: "c1", participantName: "Known Person", participantUrl: "https://www.linkedin.com/in/known", lastMessageAt: "2026-10-09T10:00:00Z" });
    const stranger = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: ACC, externalId: "c2", participantName: "Stranger", participantUrl: "https://www.linkedin.com/in/stranger", lastMessageAt: "2026-10-09T11:00:00Z" });
    addMessages(db, known.id, [{ externalId: "m1", direction: "out", bodyText: "Hi Known, saw your post", sentAt: "2026-10-08T10:00:00Z" }, { externalId: "m2", direction: "in", bodyText: "Thanks! What do you do?", sentAt: "2026-10-09T10:00:00Z" }]);
    addMessages(db, stranger.id, [{ externalId: "m3", direction: "in", bodyText: "Buy my SEO services", sentAt: "2026-10-09T11:00:00Z" }]);

    expect(listThreads(db, WS, { scope: "all", filter: "all" }).threads.map((t) => (t as { id: string }).id)).toEqual([known.id]);

    aiJson.mockResolvedValue({ body: "We help sales teams find warm leads. Open to a quick call? https://cal.com/me" });
    expect(await draftPendingReplies(db, ACC, [known.id, stranger.id])).toBe(1);
    const req = aiJson.mock.calls[0][0] as { data: { booking_url: string; guidance: string; conversation: Array<{ from: string }> } };
    expect(req.data).toMatchObject({ booking_url: "https://cal.com/me", guidance: "Be brief" });
    expect(req.data.conversation.map((m) => m.from)).toEqual(["us", "them"]);
    expect(db.prepare("SELECT ai_draft FROM inbox_threads WHERE id = ?").get(known.id)).toEqual({ ai_draft: "We help sales teams find warm leads. Open to a quick call? https://cal.com/me" });
    // Same message again: already answered, no second AI call.
    expect(await draftPendingReplies(db, ACC, [known.id])).toBe(0);
    expect(aiJson).toHaveBeenCalledTimes(1);
  });
});
