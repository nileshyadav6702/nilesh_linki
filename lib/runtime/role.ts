/**
 * Process role (LINKI_ROLE).
 *
 *   all     (default) one process serves HTTP AND runs every background loop — the original
 *           single-process deployment.
 *   web     Next.js serves HTTP only. No background loop starts in this process; a separate
 *           worker process (role "worker") runs them against the same SQLite file.
 *   worker  no HTTP. Runs the background loops (LinkedIn account workers, email campaigns,
 *           inbox sync, email jobs, warmup, verification, webhooks, AI agents, imports,
 *           retention). Started with `npm run worker` (lib/worker/entry.ts).
 *
 * Kept dependency-free so env validation and instrumentation can read it cheaply.
 */

export type LinkiRole = "all" | "web" | "worker";

export const LINKI_ROLES: readonly LinkiRole[] = ["all", "web", "worker"];

/** The configured role, or null when LINKI_ROLE is set to something unknown. Unset means "all". */
export function parseRole(raw: string | undefined): LinkiRole | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "all";
  return (LINKI_ROLES as readonly string[]).includes(v) ? (v as LinkiRole) : null;
}

/** This process's role. An unknown value falls back to "all" (validateEnv rejects it in production). */
export function linkiRole(env: NodeJS.ProcessEnv = process.env): LinkiRole {
  return parseRole(env.LINKI_ROLE) ?? "all";
}

/** True when this process may run the background loops ("all" or "worker"). */
export function runsBackgroundLoops(role: LinkiRole = linkiRole()): boolean {
  return role !== "web";
}

/**
 * True when another process runs the loops, so anything this (web) process opens on a LinkedIn
 * account must be closed again before it lets go of the account.
 */
export function isSplitWeb(role: LinkiRole = linkiRole()): boolean {
  return role === "web";
}
