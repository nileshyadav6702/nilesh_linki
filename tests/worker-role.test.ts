import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { linkiRole, parseRole, runsBackgroundLoops, isSplitWeb } from "@/lib/runtime/role";
import { validateEnv } from "@/lib/env";

/**
 * LINKI_ROLE: "all" (default) runs the loops inside Next.js as before, "web" serves HTTP only,
 * "worker" runs the loops in the separate worker process.
 */

const runner = vi.hoisted(() => ({ ensureGlobalRunnerStarted: vi.fn() }));
const retention = vi.hoisted(() => ({ startRetentionSchedule: vi.fn() }));
vi.mock("@/lib/linkedin/runner", () => runner);
vi.mock("@/lib/maintenance/retention", () => retention);

describe("role parsing", () => {
  it("defaults to all, accepts the three roles case-insensitively and rejects junk", () => {
    expect(parseRole(undefined)).toBe("all");
    expect(parseRole("")).toBe("all");
    expect(parseRole("WEB")).toBe("web");
    expect(parseRole(" worker ")).toBe("worker");
    expect(parseRole("both")).toBeNull();
    expect(linkiRole({ LINKI_ROLE: "both" } as NodeJS.ProcessEnv)).toBe("all");
    expect(runsBackgroundLoops("web")).toBe(false);
    expect(runsBackgroundLoops("all")).toBe(true);
    expect(runsBackgroundLoops("worker")).toBe(true);
    expect(isSplitWeb("web")).toBe(true);
    expect(isSplitWeb("all")).toBe(false);
  });
});

describe("instrumentation starts the loops only for LINKI_ROLE=all", () => {
  const saved = { role: process.env.LINKI_ROLE, runtime: process.env.NEXT_RUNTIME };
  beforeEach(() => {
    runner.ensureGlobalRunnerStarted.mockClear();
    retention.startRetentionSchedule.mockClear();
    process.env.NEXT_RUNTIME = "nodejs";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    if (saved.role === undefined) delete process.env.LINKI_ROLE; else process.env.LINKI_ROLE = saved.role;
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = saved.runtime;
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, 1],
    ["all", 1],
    ["web", 0],
    ["worker", 0],
  ])("LINKI_ROLE=%s → %i start(s)", async (role, starts) => {
    if (role === undefined) delete process.env.LINKI_ROLE; else process.env.LINKI_ROLE = role;
    const { register } = await import("@/instrumentation");
    await register();
    expect(runner.ensureGlobalRunnerStarted).toHaveBeenCalledTimes(starts);
    expect(retention.startRetentionSchedule).toHaveBeenCalledTimes(starts);
  });
});

describe("ensureGlobalRunnerStarted in the web process", () => {
  it("is a no-op, so API routes that call it (runs/start, signal rules) start no loops", async () => {
    const { ensureGlobalRunnerStarted } = await vi.importActual<typeof import("@/lib/linkedin/campaign/loops")>("@/lib/linkedin/campaign/loops");
    const saved = process.env.LINKI_ROLE;
    process.env.LINKI_ROLE = "web";
    try {
      ensureGlobalRunnerStarted();
      expect((globalThis as { __linkiGlobalRunnerStarted?: boolean }).__linkiGlobalRunnerStarted).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.LINKI_ROLE; else process.env.LINKI_ROLE = saved;
    }
  }, 60_000);
});

describe("validateEnv per role", () => {
  const base = { NODE_ENV: "production", NEXTAUTH_SECRET: "x".repeat(32), NEXTAUTH_URL: "https://example.com", INTERNAL_API_SECRET: "y".repeat(32) };

  it("rejects an unknown LINKI_ROLE in production", () => {
    expect(() => validateEnv({ ...base, LINKI_ROLE: "both" } as NodeJS.ProcessEnv)).toThrowError(/LINKI_ROLE/);
  });

  it("requires NEXTAUTH_SECRET and NEXTAUTH_URL for the worker too (decryption, tracking/unsubscribe links)", () => {
    expect(() => validateEnv({ NODE_ENV: "production", LINKI_ROLE: "worker", NEXTAUTH_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv)).toThrowError(/NEXTAUTH_URL/);
    expect(() => validateEnv({ NODE_ENV: "production", LINKI_ROLE: "worker", NEXTAUTH_URL: "https://example.com" } as NodeJS.ProcessEnv)).toThrowError(/NEXTAUTH_SECRET/);
  });

  it("warns when a split role has no explicit LINKI_DB_PATH", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(validateEnv({ ...base, LINKI_ROLE: "web" } as NodeJS.ProcessEnv).map((w) => w.name)).toContain("LINKI_DB_PATH");
    expect(validateEnv({ ...base, LINKI_ROLE: "worker", LINKI_DB_PATH: "/data/linki.db" } as NodeJS.ProcessEnv).map((w) => w.name)).not.toContain("LINKI_DB_PATH");
    expect(validateEnv({ ...base } as NodeJS.ProcessEnv).map((w) => w.name)).not.toContain("LINKI_DB_PATH");
    warn.mockRestore();
  });
});
