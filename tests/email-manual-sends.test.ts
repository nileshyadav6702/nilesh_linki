import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { sendEmailDurably } from "@/lib/email/infrastructure";
import { MailboxDailyCapError } from "@/lib/email/daily-cap";
import { campaignEmailsToday } from "@/lib/linkedin/actions";
import { renderOutreachTemplate, findUnresolvedTokens } from "@/lib/outreach/render";
import replyHandler from "@/pages/api/inbox/reply";
import invitationsHandler from "@/pages/api/platform/invitations";

const SEND_EMAIL = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/sender")>();
  return { ...actual, sendEmail: SEND_EMAIL };
});

const WS = "ws-manual-sends";
const accepted = (_a: unknown, _to: string, _s: string, _b: string, opts?: { messageId?: string }) =>
  Promise.resolve({ messageId: opts?.messageId ?? "<x@test>", response: "250 OK" });

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}
const mockReq = (body: unknown, role = "admin") =>
  ({ method: "POST", query: {}, body, headers: { "x-workspace-id": WS, "x-user-id": `user-${role}`, "x-workspace-role": role, host: "app.test" } }) as unknown as NextApiRequest;

function account(id: string, limit: number) {
  getDb().prepare(`INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password, daily_email_limit, timezone)
    VALUES (?, ?, 'S', ?, 'smtp.test', 'u', ?, ?, 'UTC')`).run(id, WS, `${id}@sender.test`, encryptSecret("smtp-plain-password"), limit);
}

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ||= "manual-sends-test-secret";
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Manual", "manual-sends");
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('user-admin', 'manual-admin@example.com', 'x')").run();
  db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'user-admin', 'admin')").run(WS);
});
beforeEach(() => { SEND_EMAIL.mockReset(); SEND_EMAIL.mockImplementation(accepted); });

describe("per-mailbox daily cap covers one-off sends", () => {
  it("counts manual sends and blocks the one past the cap", async () => {
    account("ea-cap", 2);
    const send = (n: number) => sendEmailDurably({ workspaceId: WS, emailAccountId: "ea-cap", idempotencyKey: `manual-${n}`, source: "contact_thread", to: `p${n}@example.com`, subject: "Hi", body: "Hello" });
    await send(1);
    await send(2);
    expect(campaignEmailsToday(getDb(), "ea-cap", "UTC")).toBe(2);
    await expect(send(3)).rejects.toBeInstanceOf(MailboxDailyCapError);
    expect(SEND_EMAIL).toHaveBeenCalledTimes(2);
    // An idempotent replay of a send that already went out is not a new send.
    await expect(send(2)).resolves.toMatchObject({ status: "sent" });
  });

  it("answers a team-inbox reply at the cap with 429, and threads replies under the cap", async () => {
    account("ea-inbox", 1);
    getDb().prepare(`INSERT INTO email_replies (id, workspace_id, from_email, subject, body_text, received_at, message_id)
      VALUES ('reply-1', ?, 'lead@example.com', 'Re: Hello', 'Sounds good', datetime('now'), '<lead-msg-1@example.com>')`).run(WS);
    const ok = mockRes();
    await replyHandler(mockReq({ emailAccountId: "ea-inbox", to: "lead@example.com", subject: "Re: Hello", body: "Great", replyId: "reply-1" }), ok);
    expect(ok.statusCode).toBe(200);
    const headers = SEND_EMAIL.mock.calls[0][4].headers;
    expect(headers["In-Reply-To"]).toBe("<lead-msg-1@example.com>");
    expect(headers.References).toBe("<lead-msg-1@example.com>");

    const capped = mockRes();
    await replyHandler(mockReq({ emailAccountId: "ea-inbox", to: "lead@example.com", subject: "Re: Hello", body: "One more thing" }), capped);
    expect(capped.statusCode).toBe(429);
    expect(capped.body.daily_limit).toBe(1);
    expect(SEND_EMAIL).toHaveBeenCalledTimes(1);
  });
});

describe("invitation email", () => {
  it("decrypts the SMTP password before handing it to the sender", async () => {
    getDb().prepare("DELETE FROM email_accounts WHERE workspace_id = ?").run(WS);
    account("ea-invite", 50);
    const res = mockRes();
    await invitationsHandler(mockReq({ email: "newbie@example.com", role: "member" }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.email_sent).toBe(true);
    expect(SEND_EMAIL.mock.calls[0][0].password).toBe("smtp-plain-password");
  });
});

describe("renderOutreachTemplate", () => {
  const target = { first_name: "", full_name: null, company: "Acme" };
  it("uses {{key|fallback}} when the value is empty", () => {
    expect(renderOutreachTemplate("Hi {{first_name|there}}, from {{ company | your team }}", target)).toBe("Hi there, from Acme");
    expect(renderOutreachTemplate("Hi {{plan|friend}}", target, { plan: "" })).toBe("Hi friend");
  });
  it("does not leave 'Hi ,' or double spaces behind an empty value", () => {
    expect(renderOutreachTemplate("Hi {{first_name}}, welcome", target)).toBe("Hi, welcome");
    expect(renderOutreachTemplate("Thanks {{first_name}} for reading", target)).toBe("Thanks for reading");
    expect(renderOutreachTemplate("Hi Ada , as typed", target)).toBe("Hi Ada , as typed");
  });
  it("leaves unknown tokens for the send check to catch, and keeps send-time tokens", () => {
    const out = renderOutreachTemplate("Hi {{frist_name}} {{unsubscribe_url}}", target);
    expect(out).toBe("Hi {{frist_name}} {{unsubscribe_url}}");
    expect(findUnresolvedTokens(out)).toEqual(["{{frist_name}}", "{{unsubscribe_url}}"]);
  });
});
