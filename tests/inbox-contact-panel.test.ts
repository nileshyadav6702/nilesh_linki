import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { findParticipantContact, upsertThread } from "@/lib/inbox/store";
import { getLeadDetail } from "@/lib/agents/copilot";
import handler from "@/pages/api/inbox/threads/[id]/contact";

const WS = "ws-inbox-panel";
const ACC = "acc-inbox-panel";

function call(id: string) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  res.end = () => res;
  handler({ method: "GET", query: { id }, headers: { "x-workspace-id": WS, "x-user-id": "panel-user", "x-workspace-role": "viewer" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: { contact: Record<string, unknown> | null } };
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('panel-user', 'panel@x.test', 'x')").run();
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'panel-user', 'viewer')").run(WS);
  db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES (?, ?, 'Me', 'me@x.io', 1)").run(ACC, WS);
  db.prepare("INSERT INTO companies (id, workspace_id, name, logo_url) VALUES ('co-panel', ?, 'Monsters Graphics', 'https://x/logo.png')").run(WS);
  // Stored under the public URL; LinkedIn messaging shows the member-id URL.
  db.prepare(`INSERT INTO targets (id, workspace_id, full_name, title, location, linkedin_url, linkedin_member_urn, company_id)
    VALUES ('t-panel', ?, 'Ahmed Saad', 'Co-Founder', 'New York City Metropolitan Area', 'https://www.linkedin.com/in/ahmed-saad', 'urn:li:fsd_profile:ACoAAB7kx0Y', 'co-panel')`).run(WS);
  db.prepare("INSERT INTO signals (id, workspace_id, target_id, type, title, weight, occurred_at) VALUES ('s-panel-1', ?, 't-panel', 'lookalike', 'Looks like your best customer', 5, '2026-10-06T00:00:00Z'), ('s-panel-2', ?, 't-panel', 'job_change', 'Strategic Window: Just hired', 30, '2026-08-01T00:00:00Z')").run(WS, WS);
});

describe("inbox contact panel", () => {
  it("matches a conversation to a contact by LinkedIn member id", () => {
    expect(findParticipantContact(getDb(), WS, "https://www.linkedin.com/in/ACoAAB7kx0Y", null)).toBe("t-panel");
    expect(findParticipantContact(getDb(), WS, "https://www.linkedin.com/in/someone-else", null)).toBeNull();
  });

  it("returns the contact with company, strongest signal and location; nothing for strangers", () => {
    const db = getDb();
    const known = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: ACC, externalId: "p1", participantName: "Ahmed Saad", participantUrl: "https://www.linkedin.com/in/ACoAAB7kx0Y", lastMessageAt: "2026-10-10T00:00:00Z" });
    const stranger = upsertThread(db, { workspaceId: WS, channel: "linkedin", accountId: ACC, externalId: "p2", participantName: "Sean", participantUrl: "https://www.linkedin.com/in/sean", lastMessageAt: "2026-10-10T00:00:00Z" });
    expect(call(known.id).body.contact).toMatchObject({
      id: "t-panel", full_name: "Ahmed Saad", title: "Co-Founder", company: "Monsters Graphics", company_logo: "https://x/logo.png",
      location: "New York City Metropolitan Area", signal: { type: "job_change", title: "Strategic Window: Just hired" },
    });
    expect(call(stranger.id).body.contact).toBeNull();
    expect(getLeadDetail(db, WS, "t-panel")?.thread_id).toBe(known.id);
  });
});
