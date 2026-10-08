import { randomUUID } from "crypto";
import { createServer } from "net";
import { describe, it, expect, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

// Saving a proxy closes the live browser context; never launch a browser in tests.
vi.mock("@/lib/linkedin/session", () => ({ closeSession: vi.fn(async () => {}) }));

import { getDb } from "@/lib/db";
import { accountProxy, checkProxyReachable, normalizeProxyUrl } from "@/lib/linkedin/proxy";
import { signatureText } from "@/lib/email/signature";
import accountHandler from "@/pages/api/accounts/[id]";
import mailboxHandler from "@/pages/api/email-accounts/[id]";

/** The agent Settings tab's LinkedIn seat and Email Sender drawers, end to end through their APIs. */

const WS = "00000000-0000-4000-8000-000000000001";
function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}
const req = (method: string, id: string, body: unknown = {}) =>
  ({ method, query: { id }, body, headers: { "x-workspace-id": WS, "x-workspace-role": "admin" } }) as unknown as NextApiRequest;

describe("proxy override", () => {
  it("normalizes proxy addresses and rejects anything else", () => {
    expect(normalizeProxyUrl("192.168.1.1:8080")).toBe("http://192.168.1.1:8080");
    expect(normalizeProxyUrl("SOCKS5://proxy.example.com:1080/")).toBe("socks5://proxy.example.com:1080");
    expect(normalizeProxyUrl("http://host")).toBeNull();
    expect(normalizeProxyUrl("http://host:70000")).toBeNull();
    expect(normalizeProxyUrl("javascript:alert(1)")).toBeNull();
  });

  it("checks that the proxy answers", async () => {
    const server = createServer((s) => s.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    expect(await checkProxyReachable(`127.0.0.1:${port}`)).toMatchObject({ ok: true });
    await new Promise<void>((r) => server.close(() => r()));
    expect(await checkProxyReachable(`127.0.0.1:${port}`, 1500)).toMatchObject({ ok: false });
  });

  it("saves, reports and clears an account's proxy; the password is stored encrypted", async () => {
    process.env.NEXTAUTH_SECRET ||= "sender-settings-test-secret";
    const db = getDb();
    const id = `acct-${randomUUID()}`;
    db.prepare("INSERT INTO accounts (id, name, email, workspace_id, timezone) VALUES (?, 'Seat', ?, ?, 'Asia/Kolkata')").run(id, `${id}@x.com`, WS);

    const bad = mockRes(); await accountHandler(req("PUT", id, { proxy_url: "not a proxy" }), bad);
    expect(bad.statusCode).toBe(400);

    const saved = mockRes(); await accountHandler(req("PUT", id, { proxy_url: "10.0.0.5:3128", proxy_username: "u", proxy_password: "s3cret" }), saved);
    expect(saved.body).toMatchObject({ proxy_url: "http://10.0.0.5:3128", proxy_username: "u", has_proxy_password: true });
    expect(saved.body).not.toHaveProperty("proxy_password");
    expect((db.prepare("SELECT proxy_password FROM accounts WHERE id = ?").get(id) as { proxy_password: string }).proxy_password).not.toBe("s3cret");
    expect(accountProxy(id)).toEqual({ server: "http://10.0.0.5:3128", username: "u", password: "s3cret" });

    const got = mockRes(); await accountHandler(req("GET", id), got);
    expect(got.body.usage_today).toEqual({ visit: 0, connect: 0, message: 0, inmail: 0 });

    const cleared = mockRes(); await accountHandler(req("PUT", id, { proxy_url: "" }), cleared);
    expect(cleared.body).toMatchObject({ proxy_url: null, has_proxy_password: false });
    expect(accountProxy(id)).toBeUndefined();
  });
});

describe("email sender settings", () => {
  it("reports today's usage and warm-up limit, and saves the tracking and unsubscribe switches", () => {
    const db = getDb();
    const id = randomUUID();
    const start = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO email_accounts (id, name, from_email, smtp_host, smtp_port, username, password, daily_email_limit, ramp_up_enabled, ramp_start_date, workspace_id)
      VALUES (?, 'M', 'me@x.com', 'smtp.x.com', 587, 'u', 'p', 30, 1, ?, ?)`).run(id, start, WS);
    const got = mockRes(); mailboxHandler(req("GET", id), got);
    expect(got.body).toMatchObject({ sent_today: 0, effective_limit: 6, track_opens: 0, include_unsubscribe: 0 });
    const put = mockRes(); mailboxHandler(req("PUT", id, { track_opens: true, include_unsubscribe: true, from_name: "Nilesh" }), put);
    expect(put.statusCode).toBe(200);
    expect(db.prepare("SELECT track_opens, include_unsubscribe, from_name FROM email_accounts WHERE id = ?").get(id)).toEqual({ track_opens: 1, include_unsubscribe: 1, from_name: "Nilesh" });
  });

  it("turns a rich-text signature into plain text that keeps links", () => {
    expect(signatureText("Best,\nNilesh")).toBe("Best,\nNilesh");
    expect(signatureText('<b>Nilesh</b><br>Heddl · <a href="https://heddl.ai">heddl.ai</a><ul><li>One</li><li>Two</li></ul>'))
      .toBe("Nilesh\nHeddl · heddl.ai (https://heddl.ai)• One\n• Two");
  });
});
