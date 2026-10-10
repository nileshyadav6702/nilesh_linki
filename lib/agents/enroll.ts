import { randomUUID } from "crypto";
import { findTargetSuppression } from "@/lib/platform/suppression";
import type Database from "better-sqlite3";
import type { Agent } from "@/lib/agents/store";

export type Channel = "linkedin_message" | "email";

/** Which channels the agent's campaign uses, from its workflow's tracks. */
export function workflowChannels(db: Database.Database, workflowId: string | null): { linkedin: boolean; email: boolean; firstLinkedinIsMessage: boolean } {
  if (!workflowId) return { linkedin: false, email: false, firstLinkedinIsMessage: false };
  const steps = db.prepare("SELECT track, step_type FROM workflow_steps WHERE workflow_id = ? AND COALESCE(enabled, 1) = 1 ORDER BY track, step_order").all(workflowId) as Array<{ track: string; step_type: string }>;
  const linkedin = steps.filter((s) => s.track !== "email" && s.step_type !== "delay");
  return {
    linkedin: linkedin.length > 0,
    email: steps.some((s) => s.track === "email" && s.step_type === "email"),
    firstLinkedinIsMessage: linkedin.some((s) => s.step_type === "message" || s.step_type === "sales_inmail"),
  };
}

/**
 * Enroll a qualified lead into the agent's campaign: reuse the agent's open run for its
 * workflow or create one (running when the agent is active), then add the lead's tracks.
 * Idempotent: a lead already in the run is left as is.
 */
export function enrollLead(db: Database.Database, agent: Agent, targetId: string): { enrolled: boolean; reason?: string } {
  if (!agent.workflow_id) return { enrolled: false, reason: "Agent has no campaign selected" };
  if (!agent.linkedin_account_id && !agent.email_account_id) return { enrolled: false, reason: "Agent has no sender account" };
  const listId = agent.list_id;
  if (listId) db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(listId, targetId);

  // Leads that must not (or not yet) be contacted are skipped with the reason, so it shows and
  // the agent doesn't retry them every pass.
  const refusal = enrollmentRefusal(db, agent, targetId);
  if (refusal) {
    // (A lead busy in another campaign keeps its status there.)
    if (!refusal.startsWith("Already in another")) {
      db.prepare("UPDATE targets SET agent_status = 'skipped', agent_status_at = datetime('now'), skip_reason = ? WHERE id = ?").run(refusal, targetId);
    }
    return { enrolled: false, reason: refusal };
  }

  return db.transaction(() => {
    // This agent's open run for its CURRENT campaign and senders: after a sender or campaign change
    // new leads start a fresh run, while leads already mid-sequence finish where they are.
    let run = db.prepare(`SELECT id, status FROM runs WHERE workspace_id = ? AND workflow_id = ? AND list_id IS ? AND status IN ('pending','running','paused')
        AND (agent_id = ? OR agent_id IS NULL) AND account_id IS ? AND email_account_id IS ?
      ORDER BY created_at DESC LIMIT 1`).get(agent.workspace_id, agent.workflow_id, listId, agent.id, agent.linkedin_account_id, agent.email_account_id) as { id: string; status: string } | undefined;
    if (!run) {
      // Leads can be queued while outreach is off; the run starts when outreach is switched on.
      const status = agent.outreach_enabled ? "running" : "pending";
      run = { id: randomUUID(), status };
      db.prepare(`INSERT INTO runs (id, workspace_id, workflow_id, list_id, account_id, email_account_id, status, started_at, agent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, agent.workspace_id, agent.workflow_id, listId, agent.linkedin_account_id, agent.email_account_id, status, status === "running" ? new Date().toISOString() : null, agent.id);
    }
    if (db.prepare("SELECT 1 FROM run_profiles WHERE run_id = ? AND target_id = ?").get(run.id, targetId)) return { enrolled: true };

    const target = db.prepare("SELECT linkedin_url, email FROM targets WHERE id = ?").get(targetId) as { linkedin_url: string | null; email: string | null };
    const tracks = (db.prepare("SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ?").all(agent.workflow_id) as Array<{ track: string }>).map((t) => t.track);
    const usable = tracks.filter((t) => (t === "email" ? !!agent.email_account_id && !!target.email : !!agent.linkedin_account_id && !!target.linkedin_url));
    if (!usable.length) return { enrolled: false, reason: "Lead is not reachable on any channel of this campaign" };

    const profileId = randomUUID();
    // The email loop only works leads with a mailbox: record the agent's now (it used to be filled in only at boot).
    const mailbox = usable.includes("email") ? agent.email_account_id : null;
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)").run(profileId, run.id, targetId, mailbox);
    const insert = db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, ?, 'pending', 0)");
    for (const track of usable) insert.run(randomUUID(), profileId, track);
    db.prepare("UPDATE targets SET agent_status = 'enrolled', agent_status_at = datetime('now') WHERE id = ?").run(targetId);
    return { enrolled: true };
  })();
}

/** Contacts who replied this recently are not put in a new sequence. */
export const RECENT_REPLY_DAYS = 30;

/** Why this lead must not be enrolled now, or null. */
export function enrollmentRefusal(db: Database.Database, agent: Agent, targetId: string): string | null {
  const suppression = findTargetSuppression(agent.workspace_id, targetId);
  if (suppression) return `On the do-not-contact list (${suppression.reason})`;
  const active = db.prepare(`SELECT w.name FROM run_profiles rp JOIN runs r ON r.id = rp.run_id JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
      LEFT JOIN workflows w ON w.id = r.workflow_id
     WHERE rp.target_id = ? AND r.workspace_id = ? AND r.status IN ('pending','running','paused') AND rt.state IN ('pending','in_progress')
       AND NOT (r.workflow_id IS ? AND (r.agent_id = ? OR r.agent_id IS NULL))
     LIMIT 1`).get(targetId, agent.workspace_id, agent.workflow_id, agent.id) as { name: string | null } | undefined;
  if (active) return `Already in another active campaign${active.name ? ` ("${active.name}")` : ""}`;
  const replied = db.prepare("SELECT MAX(COALESCE(last_replied_at, ''), COALESCE(email_replied_at, '')) at FROM targets WHERE id = ?").get(targetId) as { at: string };
  const at = replied?.at ? Date.parse(/[TZ]/.test(replied.at) ? replied.at : `${replied.at.replace(" ", "T")}Z`) : NaN;
  if (!Number.isNaN(at) && Date.now() - at < RECENT_REPLY_DAYS * 86_400_000) return `Replied in the last ${RECENT_REPLY_DAYS} days — follow up personally`;
  return null;
}

/** The agent's runs: recorded on the run, or (older runs) its campaign + list. */
const AGENT_RUNS = "workspace_id = ? AND (agent_id = ? OR (agent_id IS NULL AND workflow_id IS ? AND list_id IS ?))";
const agentRunArgs = (a: Agent) => [a.workspace_id, a.id, a.workflow_id, a.list_id];

/** Outreach switched on: start the agent's pending or paused runs so enrolled leads begin moving. */
export function activateAgentRuns(db: Database.Database, agent: Agent): void {
  db.prepare(`UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE ${AGENT_RUNS} AND status IN ('pending','paused')`)
    .run(new Date().toISOString(), ...agentRunArgs(agent));
}

/** Outreach switched off: hold every running campaign run of the agent (old ones included). Lead finding keeps going. */
export function pauseAgentRuns(db: Database.Database, agent: Agent): void {
  db.prepare(`UPDATE runs SET status = 'paused' WHERE ${AGENT_RUNS} AND status = 'running'`).run(...agentRunArgs(agent));
}

/**
 * The agent's mailbox changed: its open runs and the leads still waiting on email move to the new
 * mailbox (email steps continue from it). A LinkedIn sender or campaign change needs nothing here:
 * new leads start a fresh run, and leads mid-sequence finish on the account that invited them.
 */
export function moveAgentMailbox(db: Database.Database, agent: Agent, mailboxId: string | null): number {
  const runs = (db.prepare(`SELECT id FROM runs WHERE ${AGENT_RUNS} AND status IN ('pending','running','paused')`).all(...agentRunArgs(agent)) as Array<{ id: string }>).map((r) => r.id);
  if (!runs.length) return 0;
  const ph = runs.map(() => "?").join(",");
  db.prepare(`UPDATE runs SET email_account_id = ? WHERE id IN (${ph})`).run(mailboxId, ...runs);
  return db.prepare(`UPDATE run_profiles SET email_account_id = ? WHERE run_id IN (${ph}) AND id IN (
      SELECT run_profile_id FROM run_profile_tracks WHERE track = 'email' AND state IN ('pending','in_progress'))`).run(mailboxId, ...runs).changes;
}

/** The agent is being deleted: its leads' sequences stop and its runs end (they'd lose the approved drafts). */
export function endAgentRuns(db: Database.Database, agent: Agent): number {
  const runs = (db.prepare(`SELECT id FROM runs WHERE ${AGENT_RUNS} AND status IN ('pending','running','paused')`).all(...agentRunArgs(agent)) as Array<{ id: string }>).map((r) => r.id);
  return endRuns(db, runs, "Agent deleted");
}

/** Runs stopped for good: their leads' remaining steps are skipped and queued campaign emails cancelled. */
export function endRuns(db: Database.Database, runs: string[], reason: string): number {
  if (!runs.length) return 0;
  const ph = runs.map(() => "?").join(",");
  db.transaction(() => {
    db.prepare(`UPDATE run_profile_tracks SET state = 'skipped', error_message = ?, next_step_at = NULL
      WHERE state IN ('pending','in_progress') AND run_profile_id IN (SELECT id FROM run_profiles WHERE run_id IN (${ph}))`).run(reason, ...runs);
    db.prepare(`UPDATE email_jobs SET status = 'cancelled', last_error = ?, updated_at = datetime('now') WHERE status = 'pending' AND source = 'campaign' AND run_id IN (${ph})`).run(reason, ...runs);
    db.prepare(`UPDATE runs SET status = 'completed', completed_at = COALESCE(completed_at, datetime('now')) WHERE id IN (${ph})`).run(...runs);
  })();
  return runs.length;
}
