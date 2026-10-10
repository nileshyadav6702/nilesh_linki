import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(async (name: string) => (name.startsWith("_dmarc.") ? [["v=DMARC1; p=none"]] : name.includes("_domainkey") ? [["v=DKIM1; p=abc"]] : [["v=spf1 include:_spf.google.com ~all"]])),
  resolveMx: vi.fn(async () => [{ exchange: "mx.score.io", priority: 10 }]),
}));

import { getDb } from "@/lib/db";
import { checkDomainDeliverability } from "@/lib/platform/deliverability";

const WS = "ws-deliv-score";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES ('ds-a', ?, 'A', 'a@score.io', 'smtp', 'u', 'p')").run(WS);
  for (let i = 0; i < 10; i++) {
    db.prepare("INSERT INTO email_jobs (id, workspace_id, email_account_id, idempotency_key, recipient, subject, body_text) VALUES (?, ?, 'ds-a', ?, ?, 's', 'b')").run(`ds-j${i}`, WS, `ds-k${i}`, `r${i}@x.io`);
    db.prepare("INSERT INTO sent_messages (id, workspace_id, job_id, email_account_id, recipient, subject, message_id) VALUES (?, ?, ?, 'ds-a', ?, 's', ?)").run(`ds-s${i}`, WS, `ds-j${i}`, `r${i}@x.io`, `<ds${i}@score.io>`);
  }
  for (const [i, type] of [[0, "bounced"], [1, "bounced"]] as const) {
    db.prepare("INSERT INTO sender_events (id, workspace_id, email_account_id, provider, provider_event_id, event_type, recipient, occurred_at) VALUES (?, ?, 'ds-a', 'imap', ?, ?, ?, datetime('now'))").run(`ds-e${i}`, WS, `ds-pe${i}`, type, `r${i}@x.io`);
  }
});

describe("deliverability score", () => {
  it("uses the mailbox's real sends and bounces", async () => {
    const r = await checkDomainDeliverability({ workspaceId: WS, domain: "score.io", emailAccountId: "ds-a" });
    expect(r.sent_30d).toBe(10);
    expect(r.bounce_rate).toBeCloseTo(0.2);
    expect(r.score).toBe(60); // 90 for DNS, less the 30-point bounce cap
  });
});
