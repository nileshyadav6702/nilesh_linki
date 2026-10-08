import { getDb } from "@/lib/db";
import { processEmailJobs, withLease, recoverStaleEmailJobs } from "@/lib/email/infrastructure";
import { recoverStaleLinkedinActions } from "@/lib/linkedin/actions";
import { recoverStaleImports } from "@/lib/import-jobs";
import { shouldSyncEmailInbox, syncEmailInbox, listImapEmailAccountIds, relinkDetachedReplies } from "@/lib/email/inbox";
import { processVerificationQueue } from "@/lib/email/verify";
import { processWebhookDeliveries } from "@/lib/platform/events";
import { guard } from "@/lib/watchdog";
import { processWarmupCycle } from "@/lib/platform/deliverability";
import { processWarmupEngagement } from "@/lib/email/warmup-engagement";
import { syncDueConnections } from "@/lib/platform/connectors";
import {
  CONNECTION_SYNC_TIMEOUT_MS, DISCOVERY_BUDGET_MS, DISCOVERY_TIMEOUT_MS, IMPORT_PASS_TIMEOUT_MS, INBOX_SYNC_TIMEOUT_MS,
  NEEDS_DATA_TIMEOUT_MS, POLL_INTERVAL_MS, TICK_TIMEOUT_MS,
} from "./constants";
import { sleep } from "./track-state";
import { emailCampaignTick } from "./email-tick";
import { tick } from "./tick";

// ─── global loop ─────────────────────────────────────────────────────────────

const g = global as typeof global & { __linkiGlobalRunnerStarted?: boolean };

export function ensureGlobalRunnerStarted(): void {
  if (g.__linkiGlobalRunnerStarted) return;
  g.__linkiGlobalRunnerStarted = true;
  const db = getDb();

  // Boot recovery: whatever a previous process left mid-flight is either resumed or parked
  // for a human, never silently stuck and never blindly re-sent.
  try { recoverAtBoot(db); } catch (err) { console.error("[runner] boot recovery failed:", err instanceof Error ? err.message : err); }

  // LinkedIn stays ONE strictly-sequential loop — every LinkedIn browser-session action
  // (tick + connection sync) runs here and nowhere else, so LinkedIn is never driven from
  // two places at once. Its pacing / daily-limits / active-hours are unchanged.
  linkedinLoop().catch(err => console.error("[runner] LinkedIn loop crashed:", err));

  // Email campaign steps used to run inside the LinkedIn tick, so a logged-out or busy
  // browser stopped the mailbox too. This loop claims email tracks on its own.
  startLoop("Email campaigns", "email-campaign-runner", async () => { await emailCampaignTick(getDb()); });

  // Every other background process gets its OWN independent loop, lease and cadence, so a
  // slow or hung one can never starve the others. These are all safe SMTP/IMAP/HTTP/DB
  // work; they interleave cooperatively in this single Node process (no SQLite write
  // contention) while yielding to each other on every network await.
  //
  // Reply detection is IMAP, not LinkedIn browser work, so it belongs here and not in the
  // LinkedIn loop. It used to run at the top of tick(), which put an unbounded network await
  // in front of the entire campaign engine: one stalled mailbox froze all outreach, and
  // because the per-account throttle is only stamped after a successful sync, the stall
  // reproduced itself on every restart.
  startLoop("Email inbox sync", "email-inbox-runner", syncDueEmailInboxes);
  startLoop("Email queue", "email-jobs-runner", async () => { await processEmailJobs(); });
  startLoop("Warmup", "warmup-runner", async () => {
    await processWarmupCycle();
    await processWarmupEngagement();
  });
  startLoop("Email verification", "verification-runner", async () => {
    const verified = await processVerificationQueue(db);
    if (verified > 0) console.log(`[runner] Email verification — processed ${verified}`);
  });
  startLoop("Webhook delivery", "webhook-runner", async () => { await processWebhookDeliveries(); });
  // AI agents: non-LinkedIn signal sources (job boards, news), then scoring, enrichment,
  // drafting and auto-approval. HTTP + DB only — never touches the LinkedIn session.
  startLoop("AI agents", "agents-runner", async () => {
    const { runDueHttpSources } = await import("@/lib/signals/engine");
    const { runActiveAgents } = await import("@/lib/agents/loop");
    await runDueHttpSources();
    await runActiveAgents();
  });
  // List imports drive the LinkedIn session, so they run inside linkedinLoop, not here.
}

/**
 * Recover state a dead process left behind: stale "running" list imports go back in the
 * queue, LinkedIn actions stuck in "sending" become "uncertain" (never auto-resent), and
 * email jobs abandoned mid-lease are requeued or quarantined as uncertain.
 */
export function recoverAtBoot(db: ReturnType<typeof getDb>): void {
  const imports = recoverStaleImports(db);
  const actions = recoverStaleLinkedinActions(db);
  recoverStaleEmailJobs();
  if (imports || actions) console.warn(`[runner] Boot recovery: ${imports} stale import(s) requeued, ${actions} LinkedIn action(s) marked uncertain`);
}

/** Run `step` forever on its own leased loop. Each background process gets one of these,
 *  so one process stalling only stalls itself — never its siblings. */
export function startLoop(name: string, leaseName: string, step: () => Promise<void>): void {
  void (async () => {
    console.log(`[runner] ${name} loop started`);
    while (true) {
      try {
        // The lease is renewed for as long as step() runs, so a pass longer than the lease
        // TTL is not mistaken for a dead worker by another process.
        await withLease(leaseName, async () => { await step(); });
      } catch (err) {
        console.error(`[runner] ${name} error:`, err instanceof Error ? err.message : err);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  })().catch(err => console.error(`[runner] ${name} loop crashed:`, err));
}

/** Poll every IMAP-configured account that is due, for replies and bounces. Runs on its own
 *  loop so a stalled mailbox degrades reply detection only. Independent of whether a
 *  campaign is running, so replies still land after a campaign finishes. */
export async function syncDueEmailInboxes(): Promise<void> {
  for (const emailAccId of listImapEmailAccountIds()) {
    if (!shouldSyncEmailInbox(emailAccId)) continue;
    await guard(`Email inbox sync (${emailAccId})`, INBOX_SYNC_TIMEOUT_MS, async () => {
      const { replies, bounces } = await syncEmailInbox(emailAccId);
      if (replies > 0 || bounces > 0) {
        console.log(`[runner] Email inbox sync (${emailAccId}) — ${replies} repl${replies === 1 ? "y" : "ies"}, ${bounces} bounce(s)`);
      }
    });
  }
  // Replies whose contact was deleted wait detached until a contact with the same address
  // exists again. Doing this here as well as in the manual sweep means a recreated contact
  // gets its history back on the next poll, without anyone pressing a button.
  for (const { id } of getDb().prepare("SELECT id FROM workspaces").all() as Array<{ id: string }>) {
    try { relinkDetachedReplies(id); } catch { /* best effort — never blocks the poll */ }
  }
}

export async function linkedinLoop(): Promise<void> {
  console.log("[runner] LinkedIn loop started");
  const db = getDb();

  while (true) {
    try {
      // The lease is renewed every 15s while this pass runs (a pass lasts minutes, the lease
      // TTL is 45s) and every phase re-checks it, so a process that lost the lease stops
      // driving the session instead of sharing it with the new holder.
      await withLease("linkedin-runner", async (lease) => {
        // Outer deadline on the whole tick. Every await inside is individually bounded, but this
        // is the backstop that keeps a future unguarded await from silently killing outreach
        // again — the failure mode this loop had no defence against, since a try/catch cannot
        // catch a promise that never settles.
        await guard("Campaign tick", TICK_TIMEOUT_MS, () => tick(db, lease));
        // Connection-acceptance sync also touches the LinkedIn session, so it stays in this
        // loop — sequential with tick, never concurrent.
        if (!lease.isHeld()) return;
        await guard("Connection sync", CONNECTION_SYNC_TIMEOUT_MS, () => syncDueConnections());
        // AI-agent signal discovery reads LinkedIn through the same browser session, so it runs
        // here — after outreach, sequential with it, under its own time budget and request quotas.
        if (!lease.isHeld()) return;
        await guard("Signal discovery", DISCOVERY_TIMEOUT_MS, async () => {
          const { runLinkedInDiscovery } = await import("@/lib/signals/linkedin-discovery");
          await runLinkedInDiscovery(DISCOVERY_BUDGET_MS);
        });
        // List imports scrape Sales Navigator through the same session. They used to run on
        // their own loop, un-awaited, concurrently with this one. One bounded pass per round.
        if (!lease.isHeld()) return;
        await guard("List import", IMPORT_PASS_TIMEOUT_MS, async () => {
          const { processScheduledImports } = await import("@/lib/import-jobs");
          await processScheduledImports(db);
        });
        // Leads parked as needs_data (no headline/about to score): a few budgeted profile reads.
        if (!lease.isHeld()) return;
        await guard("Needs-data enrichment", NEEDS_DATA_TIMEOUT_MS, async () => {
          const { enrichNeedsDataLeads } = await import("@/lib/linkedin/needs-data");
          await enrichNeedsDataLeads();
        });
      });
    } catch (err) {
      console.error("[runner] LinkedIn loop pass failed:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
