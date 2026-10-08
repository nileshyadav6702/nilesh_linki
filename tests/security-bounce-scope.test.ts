import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { applyBounceCandidates } from "@/lib/email/inbox";
import { isAddressSuppressed } from "@/lib/platform/suppression";

const WS_A = "ws-sec-bounce-a";
const WS_B = "ws-sec-bounce-b";
const ACCOUNT_A = "acct-sec-bounce-a";

beforeAll(() => {
  const db = getDb();
  for (const ws of [WS_A, WS_B]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, ws, ws);
  db.prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ACCOUNT_A, WS_A, "A", "sender@a.test", "smtp.a.test", "sender@a.test", "x");
  db.prepare("INSERT INTO companies (id, workspace_id, name) VALUES (?, ?, ?)").run("co-sec-a", WS_A, "Acme");
  const insert = db.prepare("INSERT INTO targets (id, workspace_id, linkedin_url, email, email_status, company_id) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("t-sec-a-dead", WS_A, "https://www.linkedin.com/in/sec-a-dead", "dead@acme.test", "valid", "co-sec-a");
  insert.run("t-sec-a-colleague", WS_A, "https://www.linkedin.com/in/sec-a-col", "alive@acme.test", "valid", "co-sec-a");
  // Same address in another tenant — must be untouched by a bounce landing in A's mailbox.
  insert.run("t-sec-b-dead", WS_B, "https://www.linkedin.com/in/sec-b-dead", "dead@acme.test", "valid", null);
  insert.run("t-sec-b-quoted", WS_B, "https://www.linkedin.com/in/sec-b-q", "quoted@other.test", "valid", null);
});

const status = (id: string) => (getDb().prepare("SELECT email_status FROM targets WHERE id = ?").get(id) as { email_status: string }).email_status;

describe("bounce handling is scoped to the mailbox's workspace", () => {
  it("invalidates only the bounced contact in the owning workspace", () => {
    const recorded = applyBounceCandidates(getDb(), {
      account: { workspace_id: WS_A, from_email: "sender@a.test" },
      emailAccountId: ACCOUNT_A,
      dsnMessageId: "<dsn-sec-1>",
      authoritative: "dead@acme.test",
      candidates: ["dead@acme.test"],
      ourAddresses: new Set(["sender@a.test"]),
    });
    expect(recorded).toBe(1);
    expect(status("t-sec-a-dead")).toBe("invalid");
    expect(status("t-sec-a-colleague")).toBe("valid");
    expect(status("t-sec-b-dead")).toBe("valid");
    expect(isAddressSuppressed(WS_A, "dead@acme.test")).not.toBeNull();
    expect(isAddressSuppressed(WS_B, "dead@acme.test")).toBeNull();
    const company = getDb().prepare("SELECT email_domain_invalid FROM companies WHERE id = ?").get("co-sec-a") as { email_domain_invalid: number | null };
    expect(company.email_domain_invalid ?? 0).toBe(0);
  });

  it("does not treat another tenant's contact as a known (trusted) scraped address", () => {
    const recorded = applyBounceCandidates(getDb(), {
      account: { workspace_id: WS_A, from_email: "sender@a.test" },
      emailAccountId: ACCOUNT_A,
      dsnMessageId: "<dsn-sec-2>",
      authoritative: "",
      candidates: ["quoted@other.test"],
      ourAddresses: new Set(["sender@a.test"]),
    });
    expect(recorded).toBe(0);
    expect(status("t-sec-b-quoted")).toBe("valid");
    expect(isAddressSuppressed(WS_A, "quoted@other.test")).toBeNull();
    expect(isAddressSuppressed(WS_B, "quoted@other.test")).toBeNull();
  });
});
