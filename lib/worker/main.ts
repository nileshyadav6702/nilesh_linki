import fs from "fs";
import os from "os";
import path from "path";

/**
 * The background worker process (LINKI_ROLE=worker).
 *
 * Runs everything instrumentation.ts runs in the single-process mode — the LinkedIn account
 * workers, email campaigns, inbox sync, email jobs, warmup, verification, webhooks, AI agents,
 * list imports and the daily retention job — with no HTTP server, so a web restart or deploy
 * never interrupts a send and Chromium's memory lives outside the web server.
 *
 * Shutdown (SIGTERM / SIGINT): stop starting new work, let in-flight steps finish for up to
 * LINKI_WORKER_GRACE_MS (default 60s), save and close every LinkedIn browser context, close the
 * browser, release this process's leases (so a replacement worker or the web server can take
 * the accounts at once), close the database, exit 0. A second signal exits immediately.
 *
 * Liveness: the heartbeat file (LINKI_WORKER_HEARTBEAT_FILE) is touched every 15s while the
 * event loop is responsive; the Docker healthcheck fails when it goes stale.
 */

export const DEFAULT_GRACE_MS = 60_000;
export const HEARTBEAT_EVERY_MS = 15_000;

export function workerGraceMs(raw = process.env.LINKI_WORKER_GRACE_MS): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GRACE_MS;
}

export function heartbeatFile(raw = process.env.LINKI_WORKER_HEARTBEAT_FILE): string {
  return raw?.trim() || path.join(os.tmpdir(), "linki-worker.heartbeat");
}

function touch(file: string): void {
  try { fs.writeFileSync(file, new Date().toISOString()); } catch (err) {
    console.warn(`[worker] could not write heartbeat ${file}:`, err instanceof Error ? err.message : err);
  }
}

export interface ShutdownReport {
  loopsStopped: boolean;
  accountsDrained: boolean;
  sessionsClosed: number;
  leasesReleased: number;
  ms: number;
}

/**
 * Stop the loops and release everything this process holds. Safe to call once per process;
 * exported (with injectable pieces) for tests.
 */
export async function shutdownWorker(graceMs = workerGraceMs(), deps: { closeSessions?: () => Promise<string[]>; closeDatabase?: () => void } = {}): Promise<ShutdownReport> {
  const started = Date.now();
  const { requestStop, waitForLoops, waitUntil } = await import("@/lib/runtime/lifecycle");
  const { busyAccountIds } = await import("@/lib/linkedin/campaign/account-workers");
  const { releaseLeasesOwnedBy, WORKER_ID } = await import("@/lib/email/infrastructure");

  requestStop();
  const left = () => Math.max(0, graceMs - (Date.now() - started));
  const loopsStopped = await waitForLoops(left());
  // A phase abandoned by its watchdog may still be driving a browser after its loop ended.
  const accountsDrained = await waitUntil(() => busyAccountIds().size === 0, left());
  if (!loopsStopped || !accountsDrained) {
    console.warn(`[worker] grace period (${Math.round(graceMs / 1000)}s) over with work still in flight (loops stopped: ${loopsStopped}, accounts drained: ${accountsDrained}); closing anyway — interrupted LinkedIn actions and email jobs are recovered as 'uncertain', never re-sent blindly`);
  }

  let sessionsClosed = 0;
  try {
    const close = deps.closeSessions ?? (async () => (await import("@/lib/linkedin/session")).shutdownSessions());
    sessionsClosed = (await close()).length;
  } catch (err) {
    console.warn("[worker] closing LinkedIn sessions failed:", err instanceof Error ? err.message : err);
  }

  let leasesReleased = 0;
  try { leasesReleased = releaseLeasesOwnedBy(WORKER_ID); } catch (err) {
    console.warn("[worker] releasing leases failed (they expire on their own):", err instanceof Error ? err.message : err);
  }

  try {
    const close = deps.closeDatabase ?? (await import("@/lib/db")).closeDb;
    close();
  } catch (err) {
    console.warn("[worker] closing the database failed:", err instanceof Error ? err.message : err);
  }

  return { loopsStopped, accountsDrained, sessionsClosed, leasesReleased, ms: Date.now() - started };
}

/** Boot the worker: validate env, open the DB (runs migrations), start loops + retention, wire signals. */
export async function runWorker(): Promise<void> {
  const { linkiRole, parseRole } = await import("@/lib/runtime/role");
  if (!process.env.LINKI_ROLE) process.env.LINKI_ROLE = "worker";
  if (parseRole(process.env.LINKI_ROLE) !== "worker") {
    throw new Error(`The worker entrypoint needs LINKI_ROLE=worker (got "${process.env.LINKI_ROLE}").`);
  }

  const { validateEnv } = await import("@/lib/env");
  validateEnv();

  const { getDb } = await import("@/lib/db");
  const { WORKER_ID } = await import("@/lib/email/infrastructure");
  getDb();
  console.log(`[worker] starting ${WORKER_ID} (role=${linkiRole()}, db=${process.env.LINKI_DB_PATH || "./linki.db"}, node ${process.version})`);

  const hb = heartbeatFile();
  touch(hb);
  const heartbeat = setInterval(() => touch(hb), HEARTBEAT_EVERY_MS);

  const { ensureGlobalRunnerStarted } = await import("@/lib/linkedin/runner");
  ensureGlobalRunnerStarted();
  const { startRetentionSchedule } = await import("@/lib/maintenance/retention");
  startRetentionSchedule();

  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      console.warn(`[worker] ${signal} again — exiting immediately`);
      process.exit(1);
    }
    stopping = true;
    const grace = workerGraceMs();
    console.log(`[worker] ${signal} received — stopping new work, waiting up to ${Math.round(grace / 1000)}s for in-flight steps`);
    void shutdownWorker(grace)
      .then((r) => {
        clearInterval(heartbeat);
        try { fs.unlinkSync(hb); } catch { /* already gone */ }
        console.log(`[worker] stopped cleanly in ${r.ms}ms (loops stopped: ${r.loopsStopped}, accounts drained: ${r.accountsDrained}, browser contexts closed: ${r.sessionsClosed}, leases released: ${r.leasesReleased})`);
        process.exit(0);
      })
      .catch((err) => {
        console.error("[worker] shutdown failed:", err);
        process.exit(1);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  // Windows has no deliverable SIGTERM; process managers there (PM2, a parent node script)
  // ask for a graceful stop over the IPC channel instead.
  process.on("message", (msg) => { if (msg === "shutdown") onSignal("SIGTERM"); });
  // A stray rejection must not take down every loop; log it like the web server would.
  process.on("unhandledRejection", (reason) => console.error("[worker] unhandled rejection:", reason));
}
