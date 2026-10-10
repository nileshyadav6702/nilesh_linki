import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let nextError: unknown = null;
vi.mock("@/lib/email/sender", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/sender")>()),
  sendEmail: async () => { if (nextError) throw nextError; return { messageId: "<ok@x>", response: "250 OK" }; },
}));

import { getDb } from "@/lib/db";
import { classifyDsn, classifySendError } from "@/lib/email/send-errors";
import { dispatchEmailJob, RecipientRejectedError, SenderPausedError } from "@/lib/email/infrastructure";
import { encryptSecret } from "@/lib/crypto";

const WS = "ws-send-errors";
const smtpError = (props: Record<string, unknown>) => Object.assign(new Error(String(props.response ?? props.message ?? "smtp error")), props);

describe("send failure classification", () => {
  it("tells mailbox, recipient and in-flight failures apart", () => {
    expect(classifySendError(smtpError({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN", response: "535 5.7.8 Username and Password not accepted" })).kind).toBe("mailbox_auth");
    expect(classifySendError(smtpError({ responseCode: 550, command: "DATA", response: "550 5.4.5 Daily user sending quota exceeded" })).kind).toBe("mailbox_throttled");
    expect(classifySendError(smtpError({ responseCode: 421, command: "MAIL FROM", response: "421 4.7.0 Too many messages, rate limited" })).kind).toBe("mailbox_throttled");
    expect(classifySendError(smtpError({ responseCode: 451, command: "DATA", response: "451 4.3.0 Temporary local problem, try again later" })).kind).toBe("retry");
    expect(classifySendError(smtpError({ responseCode: 550, command: "RCPT TO", response: "550 5.1.1 The email account that you tried to reach does not exist" })).kind).toBe("recipient_rejected");
    expect(classifySendError(smtpError({ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" })).kind).toBe("retry"); // nothing handed over
    expect(classifySendError(smtpError({ code: "ETIMEDOUT", command: "DATA", message: "Connection timeout" })).kind).toBe("uncertain");
  });

  it("reads bounce notices: delays and soft bounces are not bounces", () => {
    expect(classifyDsn("Delivery Status Notification (Delay)", "Action: delayed\nStatus: 4.4.1")).toBe("delay");
    expect(classifyDsn("Undeliverable", "Action: failed\nStatus: 4.2.2")).toBe("soft");
    expect(classifyDsn("Undeliverable", "Action: failed\nStatus: 5.2.2\nmailbox full")).toBe("soft");
    expect(classifyDsn("Delivery Status Notification (Failure)", "Action: failed\nStatus: 5.1.1")).toBe("hard");
    expect(classifyDsn("Mail delivery failed", "The following address failed permanently: jane@x.io")).toBe("hard");
  });
});

let n = 0;
function job() {
  const db = getDb();
  n++;
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES (?, ?, 'Me', 'me@acme.io', 'smtp.acme.io', 'me', ?)").run(`mb-se-${n}`, WS, encryptSecret("pw"));
  db.prepare("INSERT INTO email_jobs (id, workspace_id, email_account_id, idempotency_key, recipient, subject, body_text, status, source) VALUES (?, ?, ?, ?, ?, 'Hi', 'Hello', 'pending', 'manual')")
    .run(`job-se-${n}`, WS, `mb-se-${n}`, `k-se-${n}`, `lead${n}@x.io`);
  return { job: `job-se-${n}`, mailbox: `mb-se-${n}`, recipient: `lead${n}@x.io` };
}
const jobRow = (id: string) => getDb().prepare("SELECT status FROM email_jobs WHERE id = ?").get(id) as { status: string };

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ||= "test-secret-for-send-errors";
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});
beforeEach(() => { nextError = null; });

describe("dispatching through a failing mailbox", () => {
  it("a refused login pauses the mailbox and keeps the email queued", async () => {
    const j = job();
    nextError = smtpError({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN", response: "535 Authentication failed" });
    await expect(dispatchEmailJob(j.job)).rejects.toBeInstanceOf(SenderPausedError);
    expect(jobRow(j.job).status).toBe("pending");
    expect((getDb().prepare("SELECT paused_at FROM email_accounts WHERE id = ?").get(j.mailbox) as { paused_at: string | null }).paused_at).toBeTruthy();
  });

  it("a quota error cools the mailbox down for an hour", async () => {
    const j = job();
    nextError = smtpError({ responseCode: 550, command: "DATA", response: "550 5.4.5 Daily user sending quota exceeded" });
    await expect(dispatchEmailJob(j.job)).rejects.toBeInstanceOf(SenderPausedError);
    const row = getDb().prepare("SELECT paused_at, cooldown_until FROM email_accounts WHERE id = ?").get(j.mailbox) as { paused_at: string | null; cooldown_until: string };
    expect(row.paused_at).toBeNull();
    expect(Date.parse(row.cooldown_until) - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(jobRow(j.job).status).toBe("pending");
  });

  it("a rejected recipient is a hard bounce: recorded, suppressed, never retried", async () => {
    const j = job();
    nextError = smtpError({ responseCode: 550, command: "RCPT TO", response: "550 5.1.1 User unknown" });
    await expect(dispatchEmailJob(j.job)).rejects.toBeInstanceOf(RecipientRejectedError);
    expect(jobRow(j.job).status).toBe("failed");
    expect(getDb().prepare("SELECT 1 FROM sender_events WHERE email_account_id = ? AND event_type = 'bounced'").get(j.mailbox)).toBeTruthy();
  });

  it("a connection timeout before any data is retried, not marked uncertain", async () => {
    const j = job();
    nextError = smtpError({ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" });
    await expect(dispatchEmailJob(j.job)).rejects.toThrow();
    expect(jobRow(j.job).status).toBe("pending");
  });
});
