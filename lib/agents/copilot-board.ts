import type Database from "better-sqlite3";
import { communityAi } from "@/lib/community-ai";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { queueDraft, sequenceSteps, strongestSignals, writeSequence } from "@/lib/agents/drafts";
import type { Agent } from "@/lib/agents/store";
import type { DraftRow } from "@/lib/agents/copilot";

/**
 * The Copilot page. Agents in autopilot mode feed "Scheduled actions" (drafts go out by
 * themselves at auto_approve_at unless rejected); agents in review mode feed "Today's priority"
 * (nothing goes out until someone approves). Optionally narrowed to one LinkedIn sender.
 */

export type CopilotMode = "autopilot" | "copilot";

export interface BoardItem {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null;
  profile_image_url: string | null; lead_score: number | null; agent_id: string; agent_name: string;
  pending: number; approved: number; auto_approve_at: string | null;
}

export interface CopilotBoard {
  items: BoardItem[];
  /** Agents finding leads in any mode, and in the requested one: drive the two empty states. */
  active: number;
  activeInMode: number;
  /** Earliest automatic launch among the listed leads (autopilot only). */
  nextLaunch: string | null;
}

export function copilotBoard(db: Database.Database, workspaceId: string, mode: CopilotMode, accountId: string | null): CopilotBoard {
  const items = db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.profile_image_url, t.lead_score, a.id agent_id, a.name agent_name,
      SUM(q.status = 'pending') pending, SUM(q.status = 'approved') approved, MIN(CASE WHEN q.status = 'pending' THEN q.auto_approve_at END) auto_approve_at
    FROM approval_queue q JOIN targets t ON t.id = q.target_id JOIN agents a ON a.id = q.agent_id
    WHERE q.workspace_id = ? AND q.status IN ('pending', 'approved') AND a.mode = ? AND (? IS NULL OR a.linkedin_account_id = ?)
      AND COALESCE(t.agent_status, '') NOT IN ('skipped', 'removed')
    GROUP BY t.id
    ORDER BY (SUM(q.status = 'pending') = 0), t.lead_score DESC, MIN(q.created_at)
    LIMIT 300`).all(workspaceId, mode, accountId, accountId) as BoardItem[];
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const active = count("SELECT COUNT(*) n FROM agents WHERE workspace_id = ? AND status = 'active'", workspaceId);
  const activeInMode = count("SELECT COUNT(*) n FROM agents WHERE workspace_id = ? AND status = 'active' AND mode = ? AND (? IS NULL OR linkedin_account_id = ?)", workspaceId, mode, accountId, accountId);
  const nextLaunch = items.map((i) => i.auto_approve_at).filter((x): x is string => !!x).sort()[0] ?? null;
  return { items, active, activeInMode, nextLaunch };
}

const DRAFT_COLUMNS = "id, step_id, channel, subject, body, status, auto_approve_at, position, updated_at";

/**
 * "View message": the lead's draft for this step, writing it now when the agent hasn't yet.
 * Returns the existing draft untouched when there is one.
 */
export async function draftForStep(db: Database.Database, workspaceId: string, targetId: string, stepId: string): Promise<DraftRow> {
  const existing = db.prepare(`SELECT ${DRAFT_COLUMNS} FROM approval_queue WHERE target_id = ? AND step_id = ? AND status IN ('pending','approved','consumed') ORDER BY created_at DESC LIMIT 1`)
    .get(targetId, stepId) as DraftRow | undefined;
  if (existing) return existing;
  const target = db.prepare("SELECT agent_id FROM targets WHERE id = ? AND workspace_id = ?").get(targetId, workspaceId) as { agent_id: string | null } | undefined;
  const agent = target?.agent_id ? db.prepare("SELECT * FROM agents WHERE id = ?").get(target.agent_id) as Agent | undefined : undefined;
  if (!agent) throw new Error("This lead isn't handled by an agent");
  const step = sequenceSteps(db, agent.workflow_id).find((s) => s.id === stepId);
  if (!step?.channel) throw new Error("This step doesn't send a message");
  const bundle = communityAi.getContactWithCompany(targetId);
  if (!bundle) throw new Error("Contact not found");
  const icp = (agent.icp_id ? getIcp(agent.icp_id, workspaceId) : getLatestIcp(workspaceId))?.data ?? null;
  const signals = strongestSignals(db, targetId);
  const written = (await writeSequence(agent, icp, [step], { contact: bundle.contact, company: bundle.company, signals })).get(step.id);
  if (!written) throw new Error("The AI didn't return a message. Try again.");
  const id = queueDraft(db, agent, targetId, step.channel, written, signals[0]?.id ?? null, step);
  return db.prepare(`SELECT ${DRAFT_COLUMNS} FROM approval_queue WHERE id = ?`).get(id) as DraftRow;
}
