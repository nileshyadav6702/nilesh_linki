import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { parseFeedbackReport } from "@/lib/email/send-errors";
import { recordProviderEvent } from "@/lib/email/infrastructure";
import { isAddressSuppressed } from "@/lib/platform/suppression";

const WS = "ws-complaints";
const ACCOUNT = "ea-complaints";

const ARF = [
  "This is an email abuse report for an email message received from IP 1.2.3.4",
  "",
  "Feedback-Type: abuse",
  "User-Agent: Yahoo!-Mail-Feedback/2.0",
  "Version: 1",
  "Original-Mail-From: <sam@kairo.io>",
  "Original-Rcpt-To: <Angry@Example.com>",
  "",
  "From: Sam <sam@kairo.io>",
  "To: angry@example.com",
  "Message-ID: <msg-1@kairo.io>",
  "Subject: Quick question",
].join("\r\n");

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES (?, ?, 'S', 'sam@kairo.io', 'smtp.test', 'u', 'p')").run(ACCOUNT, WS);
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, email, email_status) VALUES ('cmp-t1', ?, 'Angry', 'angry@example.com', 'valid')").run(WS);
  db.prepare("INSERT INTO email_jobs (id, workspace_id, email_account_id, idempotency_key, recipient, subject, body_text) VALUES ('cmp-j1', ?, ?, 'cmp-k1', 'angry@example.com', 's', 'b')").run(WS, ACCOUNT);
  db.prepare("INSERT INTO sent_messages (id, workspace_id, job_id, email_account_id, target_id, recipient, subject, message_id) VALUES ('cmp-s1', ?, 'cmp-j1', ?, 'cmp-t1', 'angry@example.com', 's', '<msg-1@kairo.io>')").run(WS, ACCOUNT);
});

describe("spam complaints (ARF feedback reports)", () => {
  it("reads the complaining recipient and our Message-ID", () => {
    expect(parseFeedbackReport(ARF)).toEqual({ recipient: "angry@example.com", messageId: "<msg-1@kairo.io>" });
    expect(parseFeedbackReport("Feedback-Type: abuse\nTo: rfc822; x@y.com")).toEqual({ recipient: "x@y.com", messageId: null });
    expect(parseFeedbackReport("Delivery Status Notification\nStatus: 5.1.1")).toBeNull();
  });

  it("a complaint suppresses the address and counts against the mailbox, but doesn't mark the address invalid", () => {
    const r = parseFeedbackReport(ARF)!;
    const res = recordProviderEvent({ workspaceId: WS, provider: "arf", providerEventId: "<arf-1@yahoo>", eventType: "complained", recipient: r.recipient!, messageId: r.messageId! });
    expect(res.matched).toBe(true);
    expect(isAddressSuppressed(WS, "angry@example.com")).not.toBeNull();
    const db = getDb();
    expect((db.prepare("SELECT status FROM sent_messages WHERE id = 'cmp-s1'").get() as { status: string }).status).toBe("complained");
    expect(db.prepare("SELECT 1 FROM sender_events WHERE email_account_id = ? AND event_type = 'complained'").get(ACCOUNT)).toBeTruthy();
    expect((db.prepare("SELECT email_status FROM targets WHERE id = 'cmp-t1'").get() as { email_status: string }).email_status).toBe("valid");
    // Re-scanning the same report is a no-op.
    expect(recordProviderEvent({ workspaceId: WS, provider: "arf", providerEventId: "<arf-1@yahoo>", eventType: "complained", recipient: r.recipient!, messageId: r.messageId! }).duplicate).toBe(true);
  });
});
