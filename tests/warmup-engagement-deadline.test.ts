import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

// An IMAP server that logs in and then never answers anything.
vi.mock("imap", () => ({
  default: class extends EventEmitter {
    connect() { setImmediate(() => this.emit("ready")); }
    getBoxes() { /* stalls */ }
    end() {}
    destroy() {}
  },
}));
vi.mock("@/lib/email/infrastructure", () => ({ sendEmailDurably: vi.fn(async () => ({ messageId: "<x@y>" })) }));

import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { processWarmupEngagement } from "@/lib/email/warmup-engagement";

const WS = "ws-warmup-deadline";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ||= "test-secret-test-secret-test-secret";
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  const acc = db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password, imap_host) VALUES (?, ?, ?, ?, 'smtp.t', 'u', ?, 'imap.t')");
  acc.run("wd-a", WS, "A", "a@wd.io", encryptSecret("p"));
  acc.run("wd-b", WS, "B", "b@wd.io", encryptSecret("p"));
  db.prepare("INSERT INTO warmup_settings (email_account_id, workspace_id, enabled, reply_rate) VALUES ('wd-a', ?, 1, 0)").run(WS);
  db.prepare("INSERT INTO warmup_messages (id, workspace_id, from_account_id, to_account_id, subject, body, status, scheduled_at, sent_at) VALUES ('wd-m', ?, 'wd-a', 'wd-b', 's', 'b', 'sent', datetime('now', '-2 hours'), datetime('now', '-2 hours'))").run(WS);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterAll(() => { vi.useRealTimers(); });

describe("warm-up engagement", () => {
  it("gives up on a mailbox that stalls after login instead of hanging", async () => {
    const pass = processWarmupEngagement(5);
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(pass).resolves.toBe(1);
    // Two hours old and not found: marked engaged so it isn't retried forever.
    expect((getDb().prepare("SELECT engaged_at FROM warmup_messages WHERE id = 'wd-m'").get() as { engaged_at: string | null }).engaged_at).not.toBeNull();
  });
});
