import { describe, it, expect, beforeAll } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { createUnsubscribeToken, verifyUnsubscribeToken, unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { isAddressSuppressed } from "@/lib/platform/suppression";
import handler from "@/pages/api/u/[token]";

const WS = "ws-unsub-1";
const OTHER_WS = "ws-unsub-2";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.send = (payload: unknown) => { res.body = payload; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: unknown) => { (res.headers as Record<string, unknown>)[k.toLowerCase()] = v; return res; };
  return res as unknown as NextApiResponse & { statusCode: number; body: string };
}
const mockReq = (method: string, token: string, ip = "10.0.0.1") =>
  ({ method, query: { token }, headers: {}, body: "List-Unsubscribe=One-Click", socket: { remoteAddress: ip } }) as unknown as NextApiRequest;

function seedContact(id: string, email: string) {
  const db = getDb();
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, email) VALUES (?, ?, ?, ?)").run(`t-${id}`, WS, id, email);
  db.prepare("INSERT INTO runs (id, workspace_id, status) VALUES (?, ?, 'running')").run(`r-${id}`, WS);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(`rp-${id}`, `r-${id}`, `t-${id}`);
  for (const track of ["email", "linkedin"]) {
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state) VALUES (?, ?, ?, 'in_progress')").run(`rp-${id}-${track}`, `rp-${id}`, track);
  }
  return `rp-${id}`;
}
const states = (profileId: string) =>
  (getDb().prepare("SELECT state, error_message FROM run_profile_tracks WHERE run_profile_id = ?").all(profileId) as Array<{ state: string; error_message: string | null }>);

beforeAll(() => {
  process.env.EMAIL_TRACKING_SECRET = "unsub-test-secret";
  process.env.EMAIL_TRACKING_BASE_URL = "https://app.linki.test";
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Unsub", "unsub-1");
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(OTHER_WS, "Unsub 2", "unsub-2");
});

describe("unsubscribe tokens", () => {
  it("round-trips the workspace and address it was minted for", () => {
    const token = createUnsubscribeToken(WS, "Ada@Example.com")!;
    expect(verifyUnsubscribeToken(token)).toEqual({ workspaceId: WS, email: "ada@example.com" });
  });

  it("rejects a token re-pointed at another address or workspace, and a tampered signature", () => {
    const token = createUnsubscribeToken(WS, "ada@example.com")!;
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const forgedEmail = `${Buffer.from(JSON.stringify([WS, "victim@example.com"])).toString("base64url")}.${sig}`;
    const forgedWs = `${Buffer.from(JSON.stringify([OTHER_WS, "ada@example.com"])).toString("base64url")}.${sig}`;
    expect(verifyUnsubscribeToken(forgedEmail)).toBeNull();
    expect(verifyUnsubscribeToken(forgedWs)).toBeNull();
    expect(verifyUnsubscribeToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });

  it("builds RFC 8058 headers with the https link and a mailto fallback", () => {
    const headers = unsubscribeHeaders(WS, "ada@example.com", "reply@sender.test");
    expect(headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.linki\.test\/api\/u\/[^>]+>, <mailto:reply@sender\.test\?subject=unsubscribe>$/);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("/api/u/[token]", () => {
  it("shows a confirmation page on GET without suppressing anyone", () => {
    const profile = seedContact("get", "get@example.com");
    const res = mockRes();
    handler(mockReq("GET", createUnsubscribeToken(WS, "get@example.com")!), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<form method=\"post\"");
    expect(isAddressSuppressed(WS, "get@example.com")).toBeNull();
    expect(states(profile).every((t) => t.state === "in_progress")).toBe(true);
  });

  it("suppresses the address, stops its tracks and cancels queued campaign mail on one-click POST", () => {
    const profile = seedContact("post", "post@example.com");
    getDb().prepare("INSERT INTO email_accounts (id, workspace_id, name, from_email, smtp_host, username, password) VALUES ('ea-unsub', ?, 'S', 's@sender.test', 'smtp', 'u', 'p')").run(WS);
    getDb().prepare("INSERT INTO email_jobs (id, workspace_id, email_account_id, idempotency_key, source, recipient, subject, body_text) VALUES ('job-unsub', ?, 'ea-unsub', 'k-unsub', 'campaign', 'post@example.com', 's', 'b')").run(WS);

    const res = mockRes();
    handler(mockReq("POST", createUnsubscribeToken(WS, "post@example.com")!), res);
    expect(res.statusCode).toBe(200);
    expect(isAddressSuppressed(WS, "post@example.com")?.reason).toBe("unsubscribe");
    expect(isAddressSuppressed(OTHER_WS, "post@example.com")).toBeNull();
    expect(states(profile)).toEqual([
      { state: "skipped", error_message: "Unsubscribed" },
      { state: "skipped", error_message: "Unsubscribed" },
    ]);
    expect((getDb().prepare("SELECT status FROM email_jobs WHERE id = 'job-unsub'").get() as { status: string }).status).toBe("cancelled");
  });

  it("refuses a forged token", () => {
    const token = createUnsubscribeToken(WS, "someone@example.com")!;
    const forged = `${Buffer.from(JSON.stringify([WS, "victim2@example.com"])).toString("base64url")}${token.slice(token.lastIndexOf("."))}`;
    const res = mockRes();
    handler(mockReq("POST", forged, "10.0.0.2"), res);
    expect(res.statusCode).toBe(400);
    expect(isAddressSuppressed(WS, "victim2@example.com")).toBeNull();
  });

  it("rate-limits repeated bad tokens from one client", () => {
    let last = 0;
    for (let i = 0; i < 31; i++) { const res = mockRes(); handler(mockReq("GET", `guess${i}.abc`, "10.0.0.9"), res); last = res.statusCode; }
    expect(last).toBe(429);
  });

  it("never rate-limits a valid one-click unsubscribe (mail providers POST from shared IPs)", () => {
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const res = mockRes();
      handler(mockReq("POST", createUnsubscribeToken(WS, `bulk${i}@example.com`)!, "10.0.0.10"), res);
      last = res.statusCode;
    }
    expect(last).toBe(200);
    expect(isAddressSuppressed(WS, "bulk39@example.com")).not.toBeNull();
  });

  it("links signed with a retired secret keep working after rotation", () => {
    const old = createUnsubscribeToken(WS, "rotated@example.com")!;
    process.env.EMAIL_TRACKING_SECRET = "unsub-test-secret-v2";
    process.env.EMAIL_TRACKING_SECRET_PREVIOUS = "unsub-test-secret";
    try {
      expect(verifyUnsubscribeToken(old)).toEqual({ workspaceId: WS, email: "rotated@example.com" });
      delete process.env.EMAIL_TRACKING_SECRET_PREVIOUS;
      expect(verifyUnsubscribeToken(old)).toBeNull();
    } finally {
      process.env.EMAIL_TRACKING_SECRET = "unsub-test-secret";
      delete process.env.EMAIL_TRACKING_SECRET_PREVIOUS;
    }
  });
});
