export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on misconfiguration before booting the background runner. On a
    // valid environment this is a no-op and the runner starts identically.
    const { validateEnv } = await import("@/lib/env");
    validateEnv();

    // LINKI_ROLE: "all" (default) runs the background loops inside this Next.js process, as
    // before. "web" serves HTTP only: the loops run in the separate worker process
    // (`npm run worker`, LINKI_ROLE=worker). See DEPLOYMENT.md.
    const { linkiRole } = await import("@/lib/runtime/role");
    const role = linkiRole();
    if (role !== "all") {
      console.log(`[instrumentation] LINKI_ROLE=${role}: background loops are not started in the web process`);
      return;
    }

    try {
      const { ensureGlobalRunnerStarted } = await import("@/lib/linkedin/runner");
      ensureGlobalRunnerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start runner:", err);
    }

    try {
      const { startRetentionSchedule } = await import("@/lib/maintenance/retention");
      startRetentionSchedule();
      const { startInboxSyncSchedule } = await import("@/lib/inbox/sync");
      startInboxSyncSchedule();
    } catch (err) {
      console.error("[instrumentation] Failed to start retention schedule:", err);
    }
  }
}
