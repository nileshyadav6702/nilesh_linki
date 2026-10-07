import { randomUUID } from "crypto";
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

  return db.transaction(() => {
    let run = db.prepare(`SELECT id, status FROM runs WHERE workspace_id = ? AND workflow_id = ? AND list_id IS ? AND status IN ('pending','running','paused')
      ORDER BY created_at DESC LIMIT 1`).get(agent.workspace_id, agent.workflow_id, listId) as { id: string; status: string } | undefined;
    if (!run) {
      const status = agent.status === "active" ? "running" : "pending";
      run = { id: randomUUID(), status };
      db.prepare(`INSERT INTO runs (id, workspace_id, workflow_id, list_id, account_id, email_account_id, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, agent.workspace_id, agent.workflow_id, listId, agent.linkedin_account_id, agent.email_account_id, status, status === "running" ? new Date().toISOString() : null);
    }
    if (db.prepare("SELECT 1 FROM run_profiles WHERE run_id = ? AND target_id = ?").get(run.id, targetId)) return { enrolled: true };

    const target = db.prepare("SELECT linkedin_url, email FROM targets WHERE id = ?").get(targetId) as { linkedin_url: string | null; email: string | null };
    const tracks = (db.prepare("SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ?").all(agent.workflow_id) as Array<{ track: string }>).map((t) => t.track);
    const usable = tracks.filter((t) => (t === "email" ? !!agent.email_account_id && !!target.email : !!agent.linkedin_account_id && !!target.linkedin_url));
    if (!usable.length) return { enrolled: false, reason: "Lead is not reachable on any channel of this campaign" };

    const profileId = randomUUID();
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(profileId, run.id, targetId);
    const insert = db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, ?, 'pending', 0)");
    for (const track of usable) insert.run(randomUUID(), profileId, track);
    db.prepare("UPDATE targets SET agent_status = 'enrolled', agent_status_at = datetime('now') WHERE id = ?").run(targetId);
    return { enrolled: true };
  })();
}

/** When an agent is switched on, start its pending run so enrolled leads begin moving. */
export function activateAgentRuns(db: Database.Database, agent: Agent): void {
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE workspace_id = ? AND workflow_id = ? AND list_id IS ? AND status = 'pending'")
    .run(new Date().toISOString(), agent.workspace_id, agent.workflow_id, agent.list_id);
}
