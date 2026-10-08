import { describe, it, expect, vi } from "vitest";
import { canonicalOrigin, internalApiOrigin, mcpResourceUrl, requestOrigin } from "@/lib/mcp/auth";
import { validateEnv } from "@/lib/env";
import { clientIp } from "@/lib/rate-limit";
import type { NextApiRequest } from "next";

const spoofed = { headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } } as unknown as NextApiRequest;

describe("canonical origin (MCP / OAuth)", () => {
  it("ignores Host and X-Forwarded-Host entirely", () => {
    const prev = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://linki.example.com/some/path";
    try {
      expect(requestOrigin(spoofed)).toBe("https://linki.example.com");
      expect(mcpResourceUrl(spoofed)).toBe("https://linki.example.com/api/mcp");
    } finally {
      if (prev === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = prev;
    }
  });

  it("falls back to localhost outside production, never to a request header", () => {
    expect(canonicalOrigin({ NODE_ENV: "development", PORT: "4321" } as NodeJS.ProcessEnv)).toBe("http://localhost:4321");
    expect(canonicalOrigin({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });

  it("throws in production without NEXTAUTH_URL", () => {
    expect(() => canonicalOrigin({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/NEXTAUTH_URL/);
  });

  it("internal API calls always target loopback", () => {
    expect(internalApiOrigin({ PORT: "3456" } as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:3456");
    expect(internalApiOrigin({} as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:3000");
  });

  it("validateEnv fails loudly in production when NEXTAUTH_URL is missing or invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => validateEnv({ NODE_ENV: "production", NEXTAUTH_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv)).toThrow(/NEXTAUTH_URL/);
      expect(() => validateEnv({ NODE_ENV: "production", NEXTAUTH_SECRET: "x".repeat(32), NEXTAUTH_URL: "not a url" } as NodeJS.ProcessEnv)).toThrow(/NEXTAUTH_URL/);
      expect(() => validateEnv({ NODE_ENV: "production", NEXTAUTH_SECRET: "x".repeat(32), NEXTAUTH_URL: "https://a.example" } as NodeJS.ProcessEnv)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("rate-limit client IP", () => {
  const req = (headers: Record<string, string>, remoteAddress = "203.0.113.9") => ({ headers, socket: { remoteAddress } });

  it("ignores forwarding headers unless TRUST_PROXY is set", () => {
    const r = req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" });
    expect(clientIp(r, {} as NodeJS.ProcessEnv)).toBe("203.0.113.9");
  });

  it("uses X-Real-IP when the proxy is trusted", () => {
    expect(clientIp(req({ "x-real-ip": "1.1.1.1" }), { TRUST_PROXY: "1" } as NodeJS.ProcessEnv)).toBe("1.1.1.1");
  });

  it("takes the right-most X-Forwarded-For entry (the one our proxy appended)", () => {
    const r = req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 8.8.4.4" });
    expect(clientIp(r, { TRUST_PROXY: "1" } as NodeJS.ProcessEnv)).toBe("8.8.4.4");
  });

  it("uses the NextAuth-stamped peer address when there is no socket", () => {
    expect(clientIp({ headers: { "x-linki-remote-addr": "198.51.100.7" } }, {} as NodeJS.ProcessEnv)).toBe("198.51.100.7");
  });
});
