import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { assertPublicWebhookUrl, emitDomainEvent, guardedLookup, isBlockedAddress, processWebhookDeliveries } from "@/lib/platform/events";

describe("webhook SSRF guard", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it.each([
    "https://127.0.0.1/hook", "https://[::1]/hook", "https://[::ffff:127.0.0.1]/hook", "http://169.254.169.254/latest/meta-data",
    "https://2130706433/", "https://localhost/hook", "https://metadata.google.internal/", "ftp://example.com/", "https://u:p@example.com/",
  ])("rejects %s", (url) => {
    expect(() => assertPublicWebhookUrl(url)).toThrow();
  });

  it("accepts a public https URL", () => {
    expect(assertPublicWebhookUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
  });

  it("connect-time lookup refuses names resolving to loopback", async () => {
    const err = await new Promise<Error | null>((resolve) => guardedLookup("localhost", {}, (e) => resolve(e)));
    expect(err?.message).toMatch(/non-public/);
  });

  it("a stored internal endpoint is never called and the delivery fails", async () => {
    const db = getDb();
    const ws = "ws-sec-webhook-0001";
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, "Hook", "sec-hook");
    db.prepare("INSERT INTO webhook_endpoints (id, workspace_id, url, secret) VALUES (?, ?, ?, ?)").run("ep-sec-1", ws, "https://169.254.169.254/latest", "s");
    emitDomainEvent({ workspaceId: ws, type: "contact.created", payload: {} });
    await processWebhookDeliveries();
    const row = db.prepare("SELECT status, last_error FROM webhook_deliveries WHERE endpoint_id = ?").get("ep-sec-1") as { status: string; last_error: string };
    expect(row.status).toBe("retrying");
    expect(row.last_error).toMatch(/public/);
  });
});
