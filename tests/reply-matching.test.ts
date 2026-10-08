import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// Reply detection against a fake IMAP server that holds a scripted mailbox. The header scan
// reads FROM/DATE/IN-REPLY-TO/REFERENCES; capture fetches the full message by UID and stores
// it in email_replies, which is what these tests assert on.

interface FakeMessage { uid: number; from: string; date: Date; inReplyTo?: string; references?: string; body?: string }
let mailbox: FakeMessage[] = [];

function rawHeaders(m: FakeMessage): string {
  return [
    `From: Someone <${m.from}>`,
    `Date: ${m.date.toUTCString()}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
  ].join("\r\n") + "\r\n\r\n";
}

function rawMessage(m: FakeMessage): string {
  return rawHeaders(m).replace(/\r\n\r\n$/, "\r\n")
    + `Message-ID: <in-${m.uid}-${m.from}>\r\nSubject: Re: Hi\r\nContent-Type: text/plain\r\n\r\n${m.body ?? "Sounds good"}\r\n`;
}

class FakeFetch extends EventEmitter {}

class FakeImap extends EventEmitter {
  seq = {
    fetch: () => {
      const fetch = new FakeFetch();
      setImmediate(() => fetch.emit("end"));
      return fetch;
    },
  };
  connect() { setImmediate(() => this.emit("ready")); }
  openBox(_n: string, _ro: boolean, cb: (err: Error | null, box: unknown) => void) {
    setImmediate(() => cb(null, { messages: { total: mailbox.length } }));
  }
  search(_criteria: unknown, cb: (err: Error | null, uids: number[]) => void) {
    setImmediate(() => cb(null, mailbox.map((m) => m.uid)));
  }
  fetch(source: number | number[]) {
    const fetch = new FakeFetch();
    const wanted = Array.isArray(source) ? source : [source];
    const headersOnly = Array.isArray(source);
    setImmediate(() => {
      for (const m of mailbox.filter((x) => wanted.includes(x.uid))) {
        const msg = new EventEmitter();
        fetch.emit("message", msg);
        const body = new EventEmitter();
        msg.emit("body", body, { which: headersOnly ? "HEADER" : "" });
        body.emit("data", Buffer.from(headersOnly ? rawHeaders(m) : rawMessage(m)));
        body.emit("end");
        msg.emit("attributes", { uid: m.uid, date: m.date });
        msg.emit("end");
      }
      fetch.emit("end");
    });
    return fetch;
  }
  end() { this.emit("end"); }
  destroy() {}
}

vi.mock("imap", () => ({ default: FakeImap }));
// Classification is not under test, and must not reach for an AI provider.
vi.mock("@/lib/premium", () => ({ premium: {} }));

type Db = ReturnType<typeof import("@/lib/db").getDb>;
let db: Db;
let syncEmailInbox: typeof import("@/lib/email/inbox").syncEmailInbox;

const DAY = 86_400_000;
const sqliteTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/** A fresh workspace + IMAP mailbox per test, so contacts never leak between cases. */
function setupWorkspace() {
  const ws = `ws-${randomUUID()}`;
  const acc = `acc-${randomUUID()}`;
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, 'Reply', ?)").run(ws, ws);
  db.prepare(`INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, imap_host, username, password)
    VALUES (?, ?, 'Acc', 'me@sender.test', 'smtp.sender.test', 'imap.sender.test', 'me@sender.test', 'pw')`).run(acc, ws);
  return { ws, acc };
}

function addTarget(ws: string, email: string): string {
  const id = `t-${randomUUID()}`;
  db.prepare("INSERT INTO targets (id, workspace_id, email) VALUES (?, ?, ?)").run(id, ws, email);
  return id;
}

/** A campaign email that went out to `targetId` at `sentAt`; returns its Message-ID. */
function sendCampaignEmail(ws: string, acc: string, targetId: string, email: string, sentAt: number): string {
  const jobId = randomUUID();
  const messageId = `<${jobId}@sender.test>`;
  db.prepare(`INSERT INTO email_jobs (id, workspace_id, email_account_id, target_id, idempotency_key, source, recipient, subject, body_text, status, updated_at)
    VALUES (?, ?, ?, ?, ?, 'campaign', ?, 'Hi', 'Body', 'sent', ?)`).run(jobId, ws, acc, targetId, jobId, email, sqliteTime(sentAt));
  db.prepare(`INSERT INTO sent_messages (id, workspace_id, job_id, email_account_id, target_id, recipient, subject, message_id, accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, 'Hi', ?, ?)`).run(randomUUID(), ws, jobId, acc, targetId, email, messageId, sqliteTime(sentAt));
  return messageId;
}

function repliesFor(acc: string) {
  return db.prepare("SELECT target_id, from_email FROM email_replies WHERE email_account_id = ? ORDER BY received_at").all(acc) as Array<{ target_id: string; from_email: string }>;
}

beforeAll(async () => {
  // One-time module transform + fresh-DB migrations; see tests/inbox-uid-race.test.ts.
  const { getDb } = await import("@/lib/db");
  db = getDb();
  ({ syncEmailInbox } = await import("@/lib/email/inbox"));
}, 60_000);

beforeEach(() => { mailbox = []; });

describe("email reply matching", () => {
  it("ignores mail a contact sent before the first campaign email", async () => {
    const { ws, acc } = setupWorkspace();
    const now = Date.now();
    const t = addTarget(ws, "early@lead.test");
    sendCampaignEmail(ws, acc, t, "early@lead.test", now - 2 * DAY);
    mailbox = [{ uid: 1, from: "early@lead.test", date: new Date(now - 10 * DAY), body: "An old thread" }];

    const r = await syncEmailInbox(acc);

    expect(r.replies).toBe(0);
    expect(repliesFor(acc)).toEqual([]);
  });

  it("counts mail that arrived after the first campaign email", async () => {
    const { ws, acc } = setupWorkspace();
    const now = Date.now();
    const t = addTarget(ws, "later@lead.test");
    sendCampaignEmail(ws, acc, t, "later@lead.test", now - 2 * DAY);
    mailbox = [
      { uid: 1, from: "later@lead.test", date: new Date(now - 10 * DAY), body: "Before" },
      { uid: 2, from: "later@lead.test", date: new Date(now - DAY), body: "After" },
    ];

    const r = await syncEmailInbox(acc);

    expect(r.replies).toBe(1);
    expect(repliesFor(acc)).toEqual([{ target_id: t, from_email: "later@lead.test" }]);
  });

  it("attributes a reply from another address by In-Reply-To, and never to a DSN", async () => {
    const { ws, acc } = setupWorkspace();
    const now = Date.now();
    const t = addTarget(ws, "boss@acme.test");
    const msgId = sendCampaignEmail(ws, acc, t, "boss@acme.test", now - 3 * DAY);
    mailbox = [
      { uid: 5, from: "assistant@acme.test", date: new Date(now - DAY), inReplyTo: msgId, references: msgId, body: "Replying for my boss" },
      // A bounce quotes the original's Message-ID too; it must not be taken for the reply.
      { uid: 6, from: "mailer-daemon@mx.acme.test", date: new Date(now - DAY / 2), inReplyTo: msgId, body: "Delivery failed" },
    ];

    const r = await syncEmailInbox(acc);

    expect(r.replies).toBe(1);
    expect(repliesFor(acc)).toEqual([{ target_id: t, from_email: "assistant@acme.test" }]);
  });

  it("does not let contacts that share an address overwrite each other", async () => {
    const { ws, acc } = setupWorkspace();
    const now = Date.now();
    const older = addTarget(ws, "shared@co.test");
    const newer = addTarget(ws, "shared@co.test");
    const olderMsg = sendCampaignEmail(ws, acc, older, "shared@co.test", now - 5 * DAY);
    sendCampaignEmail(ws, acc, newer, "shared@co.test", now - 2 * DAY);
    mailbox = [
      // Threaded onto the older contact's email: that contact, not the most recent one.
      { uid: 10, from: "shared@co.test", date: new Date(now - 4 * DAY), references: olderMsg, body: "Re the first" },
      // No threading headers: the contact emailed most recently from this mailbox.
      { uid: 11, from: "shared@co.test", date: new Date(now - DAY), body: "Fresh mail" },
    ];

    const r = await syncEmailInbox(acc);

    expect(r.replies).toBe(2);
    const rows = repliesFor(acc);
    expect(rows.map((x) => x.target_id).sort()).toEqual([older, newer].sort());
  });

  it("only uses sends from this workspace's mailbox for threading", async () => {
    const a = setupWorkspace();
    const b = setupWorkspace();
    const now = Date.now();
    const ta = addTarget(a.ws, "x@lead.test");
    addTarget(b.ws, "x@lead.test");
    const otherMsg = sendCampaignEmail(b.ws, b.acc, addTarget(b.ws, "y@lead.test"), "y@lead.test", now - 3 * DAY);
    sendCampaignEmail(a.ws, a.acc, ta, "x@lead.test", now - 3 * DAY);
    // References workspace B's email but lands in A's mailbox from an unknown address.
    mailbox = [{ uid: 3, from: "stranger@lead.test", date: new Date(now - DAY), inReplyTo: otherMsg }];

    const r = await syncEmailInbox(a.acc);

    expect(r.replies).toBe(0);
    expect(repliesFor(a.acc)).toEqual([]);
  });
});
