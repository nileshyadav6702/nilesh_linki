import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { accountCounts, addMessages, getThread, listThreads, setTriage, upsertThread } from "@/lib/inbox/store";
import { normalizeSubject, parseAddress, storeMail } from "@/lib/inbox/email-sync";
import { messagesPath, messagesQueryId, parseConversations, parseMessages } from "@/lib/inbox/linkedin-parse";

const WS = "ws-inbox";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email) VALUES (?, ?, ?, ?)").run("ib-li", WS, "Nilesh", "n@x.test");
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, email) VALUES (?, ?, ?, ?, ?)").run("ib-t1", WS, "Sean Pinto", "https://www.linkedin.com/in/seanp/", "sean@acme.test");
});

const member = (first: string, distance: string, url = "https://www.linkedin.com/in/seanp") => ({
  participantType: { member: { firstName: { text: first }, lastName: { text: "Pinto" }, headline: { text: "Head of Marketing" }, profileUrl: url, distance } },
});

describe("LinkedIn parsing", () => {
  const payload = { data: { x: { elements: [{
    _type: "com.linkedin.messenger.Conversation", entityUrn: "urn:li:msg_conversation:(me,1)", backendUrn: "urn:li:messagingThread:1", conversationUrl: "https://www.linkedin.com/messaging/thread/1",
    lastActivityAt: 1790000000000, unreadCount: 2,
    conversationParticipants: [member("Me", "SELF", "https://www.linkedin.com/in/me"), member("Sean", "DISTANCE_1")],
    messages: { elements: [{ _type: "com.linkedin.messenger.Message", backendUrn: "m1", deliveredAt: 1790000000000, body: { text: "Hi there" }, sender: member("Sean", "DISTANCE_1") }] },
  }] } } };

  it("reads conversations: the other person, unread, latest message", () => {
    const [c] = parseConversations(payload);
    expect(c).toMatchObject({ externalId: "urn:li:messagingThread:1", unread: true, other: { name: "Sean Pinto", headline: "Head of Marketing", self: false }, preview: { bodyText: "Hi there", direction: "in" } });
  });

  it("reads messages in order, own ones outgoing, deleted ones labelled", () => {
    const msgs = parseMessages({ data: { e: [
      { _type: "com.linkedin.messenger.Message", backendUrn: "b", deliveredAt: 2000, body: { text: "" }, messageBodyRenderFormat: "RECALLED", sender: member("Me", "SELF") },
      { _type: "com.linkedin.messenger.Message", backendUrn: "a", deliveredAt: 1000, body: { text: "Hello" }, sender: member("Sean", "DISTANCE_1") },
    ] } });
    expect(msgs.map((m) => [m.externalId, m.direction, m.bodyText])).toEqual([["a", "in", "Hello"], ["b", "out", "This message was deleted."]]);
  });

  it("finds the page's messages query and encodes the conversation urn", () => {
    expect(messagesQueryId(["x?queryId=messengerMessages.abc123&variables=(conversationUrn:urn)"])).toBe("messengerMessages.abc123");
    expect(messagesPath("messengerMessages.abc", "urn:li:msg_conversation:(a,b)")).toContain("conversationUrn:urn%3Ali%3Amsg_conversation%3A%28a%2Cb%29");
  });
});

describe("inbox store", () => {
  it("upserts threads, links the contact, keeps local unread and triage", () => {
    const db = getDb();
    const t = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: "ib-li", externalId: "th1", participantName: "Sean Pinto", participantUrl: "https://www.linkedin.com/in/seanp", lastMessageAt: "2026-10-01T10:00:00.000Z", unread: true, snippet: "Hi" });
    addMessages(db, t.id, [{ externalId: "m1", direction: "in", bodyText: "Hi", sentAt: "2026-10-01T10:00:00.000Z" }]);
    expect(getThread(db, WS, t.id)?.thread).toMatchObject({ target_id: "ib-t1", unread: 1, has_inbound: 1 });

    setTriage(db, WS, t.id, { unread: false, interested: true });
    // Same activity again: the local "read" sticks.
    expect(upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: "ib-li", externalId: "th1", lastMessageAt: "2026-10-01T10:00:00.000Z", unread: true }).changed).toBe(false);
    expect(listThreads(db, WS, { scope: "all", filter: "unread" }).total).toBe(0);
    expect(listThreads(db, WS, { scope: "linkedin:ib-li", filter: "interested" }).total).toBe(1);

    setTriage(db, WS, t.id, { deleted: true });
    expect(listThreads(db, WS, { scope: "all", filter: "all" }).total).toBe(0);
    // New activity brings a deleted conversation back.
    upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: "ib-li", externalId: "th1", lastMessageAt: "2026-10-02T10:00:00.000Z", unread: true });
    expect(listThreads(db, WS, { scope: "all", filter: "unread" }).total).toBe(1);
    expect(accountCounts(db, WS).linkedin.accounts[0]).toMatchObject({ id: "ib-li", count: 1 });
  });

  it("groups mail into threads, own mail outgoing, matched to the contact", () => {
    const mail = (id: string, from: string, date: string, subject = "Partner onboarding") =>
      ({ id, threadKey: "g1", subject, fromName: null, fromEmail: from, toEmail: "me@x.test", date, text: `Body ${id}`, html: null, unread: id === "e2" });
    const r = storeMail(WS, "ib-mail", "me@x.test", [mail("e1", "sean@acme.test", "2026-10-03T09:00:00.000Z"), mail("e2", "me@x.test", "2026-10-03T10:00:00.000Z", "Re: Partner onboarding")]);
    expect(r).toEqual({ threads: 1, messages: 2 });
    const list = listThreads(getDb(), WS, { scope: "email", filter: "all" }).threads as Array<Record<string, unknown>>;
    expect(list[0]).toMatchObject({ participant_email: "sean@acme.test", target_id: "ib-t1", unread: 1, subject: "Re: Partner onboarding" });
    const msgs = getThread(getDb(), WS, String(list[0].id))!.messages as Array<{ direction: string }>;
    expect(msgs.map((m) => m.direction)).toEqual(["in", "out"]);
  });

  it("parses addresses and subjects", () => {
    expect(parseAddress('"Jane Doe" <Jane@X.com>')).toEqual({ name: "Jane Doe", email: "jane@x.com" });
    expect(parseAddress("bob@y.io")).toEqual({ name: null, email: "bob@y.io" });
    expect(normalizeSubject("Re: Fwd: RE: Hello")).toBe("hello");
  });
});
