// Fail-fast environment validation, run once at server startup (instrumentation.ts)
// BEFORE the background runner is imported. The goal is a single, clear error at
// boot instead of confusing downstream failures (e.g. NEXTAUTH_SECRET is the HKDF
// input for lib/crypto.ts, so a missing value silently breaks session decryption).
//
// This module contains no LinkedIn/browser logic and never imports the runner.
//
// Per role (LINKI_ROLE, lib/runtime/role.ts) the required set is the SAME for "all", "web" and
// "worker":
//   - NEXTAUTH_SECRET: the web signs sessions with it; the worker derives the key that decrypts
//     LinkedIn cookies, mailbox passwords and API keys from it. Both must have the same value.
//   - NEXTAUTH_URL: the web's canonical origin (OAuth/MCP audience, redirects); the worker builds
//     every outgoing link from it (open/click tracking, one-click unsubscribe, webhook payload
//     URLs), so a worker without it would send emails with broken links.
// In the split deployment (web / worker) LINKI_DB_PATH should be set explicitly and point both
// processes at the same file; a missing value only warns (both default to ./linki.db).

import { LINKI_ROLES, parseRole } from "@/lib/runtime/role";

type EnvIssue = { name: string; reason: string };

/**
 * Validate process environment. In production, missing REQUIRED variables throw a
 * single aggregated error. Missing RECOMMENDED variables only warn. Outside
 * production (dev/test) nothing throws, so local workflows and unit tests are
 * unaffected.
 *
 * Returns the list of warnings emitted (useful for tests); throws on required
 * failures in production.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const isProduction = env.NODE_ENV === "production";

  const missing: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  const isBlank = (v: string | undefined) => !v || v.trim() === "";

  const role = parseRole(env.LINKI_ROLE);
  if (role === null) {
    missing.push({ name: "LINKI_ROLE", reason: `must be one of ${LINKI_ROLES.join(", ")} (got "${env.LINKI_ROLE}").` });
  } else if (role !== "all" && isBlank(env.LINKI_DB_PATH)) {
    warnings.push({
      name: "LINKI_DB_PATH",
      reason: `not set with LINKI_ROLE=${role} - the web and worker processes must open the same SQLite file; set it explicitly in both.`,
    });
  }

  // Required in production. NEXTAUTH_SECRET signs sessions AND derives the
  // encryption key for stored email passwords, LinkedIn cookies, API keys, and
  // webhook secrets - without it those cannot be decrypted.
  if (isBlank(env.NEXTAUTH_SECRET)) {
    missing.push({
      name: "NEXTAUTH_SECRET",
      reason: "required to sign sessions and derive the secret-encryption key. Generate with: openssl rand -base64 32",
    });
  }

  // Required in production: the canonical public origin. It is the OAuth/MCP token
  // audience and the only trusted source of this server's own URL — without it the
  // origin would have to be derived from client-controlled Host headers (see
  // lib/mcp/auth.ts canonicalOrigin). Also the base for NextAuth redirects and
  // default email tracking URLs.
  if (isBlank(env.NEXTAUTH_URL)) {
    missing.push({
      name: "NEXTAUTH_URL",
      reason: "required - the public HTTPS URL of this deployment (e.g. https://linki.example.com).",
    });
  } else {
    try {
      const url = new URL(env.NEXTAUTH_URL!.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      missing.push({ name: "NEXTAUTH_URL", reason: "must be an absolute http(s) URL." });
    }
  }

  // Recommended: server-to-server secret for the MCP server calling Linki's own
  // API over loopback. Only needed if the MCP endpoint is used, so warn only.
  if (isBlank(env.INTERNAL_API_SECRET)) {
    warnings.push({
      name: "INTERNAL_API_SECRET",
      reason: "not set - internal service calls (e.g. the MCP server) will be unauthenticated or fail.",
    });
  }

  for (const w of warnings) {
    console.warn(`[env] Warning: ${w.name} ${w.reason}`);
  }

  if (missing.length > 0) {
    const details = missing.map(m => `  - ${m.name}: ${m.reason}`).join("\n");
    const message =
      `Invalid environment configuration. The following required variable(s) are missing:\n${details}\n` +
      `See .env.example for the full list.`;
    if (isProduction) {
      throw new Error(message);
    }
    // In dev/test, surface the problem loudly but do not crash the process.
    console.warn(`[env] ${message}`);
  }

  return warnings;
}
