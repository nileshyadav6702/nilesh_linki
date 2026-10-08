import type Database from "better-sqlite3";
import { communityAi } from "@/lib/community-ai";
import { getIcp, getLatestIcp } from "@/lib/icp/store";
import { rewriteStep, sequenceSteps, strongestSignals, type SequenceStep } from "@/lib/agents/drafts";
import type { Agent } from "@/lib/agents/store";

/**
 * One contact as Copilot, the lead drawer and the leads table see it: profile, company,
 * signals, the agent, and the campaign sequence with this contact's draft (or sent text)
 * at every step.
 */

export interface DraftRow { id: string; step_id: string | null; channel: string; subject: string | null; body: string; status: string; auto_approve_at: string | null; position: number | null; updated_at: string | null }

export interface LeadDetail {
  contact: Record<string, unknown>;
  company: Record<string, unknown> | null;
  signals: Array<{ id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string; metadata_json?: string | null }>;
  agent: Pick<Agent, "id" | "name" | "mode" | "outreach_enabled" | "status" | "workflow_id"> & { workflow_name: string | null } | null;
  sequence: Array<SequenceStep & { draft: DraftRow | null }>;
  /** Drafts not tied to a step (older first-touch drafts). */
  loose_drafts: DraftRow[];
  outreach: Array<{ track: string; state: string; current_step: number; next_step_at: string | null }>;
  /** Newest first: where the contact came from, outreach milestones, team actions and logged notes. */
  activity: Array<{ at: string; kind: "source" | "outreach" | "team" | "note"; text: string }>;
}

const AUDIT_TEXT: Record<string, string> = {
  "lead.skipped": "Rejected", "lead.enrolled": "Added to the campaign", "lead.removed": "Removed from the campaign",
};

function leadActivity(db: Database.Database, workspaceId: string, c: Record<string, unknown>, agentName: string | null): LeadDetail["activity"] {
  const out: LeadDetail["activity"] = [];
  const at = (v: unknown) => (typeof v === "string" && v ? v : null);
  const lists = (db.prepare("SELECT l.name FROM list_targets lt JOIN lists l ON l.id = lt.list_id WHERE lt.target_id = ? LIMIT 3").all(c.id) as Array<{ name: string }>).map((l) => l.name);
  const created = at(c.created_at);
  if (created) {
    const from = lists.length ? `Imported from ${lists.join(", ")}` : `Added from ${String(c.lead_source ?? "a source").replace(/_/g, " ")}`;
    out.push({ at: created, kind: "source", text: agentName ? `${from} · agent ${agentName}` : from });
  }
  const milestones: Array<[string, string]> = [
    ["connection_requested_at", "Connection request sent"], ["connected_at", "Connection accepted"], ["message_sent_at", "LinkedIn message sent"],
    ["last_replied_at", "Replied on LinkedIn"], ["email_replied_at", "Replied by email"],
  ];
  for (const [col, text] of milestones) { const t = at(c[col]); if (t) out.push({ at: t, kind: "outreach", text }); }
  for (const a of db.prepare("SELECT action, metadata_json, created_at FROM audit_logs WHERE workspace_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 20").all(workspaceId, c.id) as Array<{ action: string; metadata_json: string | null; created_at: string }>) {
    let reason = "";
    try { reason = (JSON.parse(a.metadata_json ?? "{}") as { reason?: string }).reason ?? ""; } catch { /* not JSON */ }
    out.push({ at: a.created_at, kind: "team", text: `${AUDIT_TEXT[a.action] ?? a.action.replace(/[._]/g, " ")}${reason ? ` · ${reason}` : ""}` });
  }
  for (const n of db.prepare("SELECT type, body, logged_at FROM activity_logs WHERE target_id = ? ORDER BY logged_at DESC LIMIT 20").all(c.id) as Array<{ type: string; body: string; logged_at: string }>) {
    out.push({ at: n.logged_at, kind: "note", text: `${n.type === "note" ? "" : `${n.type[0].toUpperCase()}${n.type.slice(1)}: `}${n.body}` });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}

const CONTACT_COLUMNS = `id, full_name, first_name, last_name, headline, title, company, location, linkedin_url, sales_nav_url, email, email_status, phone,
  profile_image_url, degree, summary, fit_score, fit_verdict, fit_reason, fit_confidence, intent_score, lead_score, agent_id, agent_status,
  agent_status_at, skip_reason, lead_source, connection_requested_at, connected_at, message_sent_at, last_replied_at, email_replied_at, company_id, created_at,
  notes, company_logo_url, company_linkedin_url, company_industry, company_location, company_size, company_description, tenure_months`;

export function getLeadDetail(db: Database.Database, workspaceId: string, targetId: string): LeadDetail | null {
  const contact = db.prepare(`SELECT ${CONTACT_COLUMNS} FROM targets WHERE id = ? AND workspace_id = ?`).get(targetId, workspaceId) as Record<string, unknown> | undefined;
  if (!contact) return null;
  const company = contact.company_id ? db.prepare("SELECT id, name, domain, website, industry, employee_count, employee_range, location, description, linkedin_url, logo_url FROM companies WHERE id = ?").get(contact.company_id) as Record<string, unknown> | undefined : undefined;
  const signals = db.prepare("SELECT id, type, title, snippet, source_url, occurred_at, metadata_json FROM signals WHERE target_id = ? ORDER BY occurred_at DESC LIMIT 20").all(targetId) as LeadDetail["signals"];
  const agent = contact.agent_id ? db.prepare(`SELECT a.id, a.name, a.mode, a.outreach_enabled, a.status, a.workflow_id, w.name workflow_name
    FROM agents a LEFT JOIN workflows w ON w.id = a.workflow_id WHERE a.id = ?`).get(contact.agent_id) as LeadDetail["agent"] | undefined : undefined;
  const drafts = db.prepare(`SELECT id, step_id, channel, subject, body, status, auto_approve_at, position, updated_at FROM approval_queue
    WHERE target_id = ? AND status != 'rejected' ORDER BY created_at DESC`).all(targetId) as DraftRow[];
  const steps = sequenceSteps(db, agent?.workflow_id ?? null);
  const sequence = steps.map((s) => ({ ...s, draft: drafts.find((d) => d.step_id === s.id) ?? null }));
  const loose = drafts.filter((d) => !d.step_id);
  const outreach = db.prepare(`SELECT rpt.track, rpt.state, rpt.current_step, rpt.next_step_at FROM run_profile_tracks rpt
    JOIN run_profiles rp ON rp.id = rpt.run_profile_id JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.workspace_id = ? ORDER BY rp.created_at DESC LIMIT 2`).all(targetId, workspaceId) as LeadDetail["outreach"];
  return { contact, company: company ?? null, signals, agent: agent ?? null, sequence, loose_drafts: loose, outreach, activity: leadActivity(db, workspaceId, contact, agent?.name ?? null) };
}

/** Regenerate one step's draft, or refine it with an instruction such as "make it shorter". */
export async function regenerateDraft(db: Database.Database, workspaceId: string, draftId: string, instruction: string | null): Promise<DraftRow> {
  const draft = db.prepare("SELECT * FROM approval_queue WHERE id = ? AND workspace_id = ?").get(draftId, workspaceId) as DraftRow & { target_id: string; agent_id: string | null } | undefined;
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "pending") throw new Error(`Draft already ${draft.status}`);
  const agent = draft.agent_id ? db.prepare("SELECT * FROM agents WHERE id = ?").get(draft.agent_id) as Agent | undefined : undefined;
  if (!agent) throw new Error("This draft has no agent");
  const icp = (agent.icp_id ? getIcp(agent.icp_id, workspaceId) : getLatestIcp(workspaceId))?.data ?? null;
  const steps = sequenceSteps(db, agent.workflow_id);
  const step = steps.find((s) => s.id === draft.step_id)
    ?? { id: draft.step_id ?? "first", track: draft.channel === "email" ? "email" : "linkedin", step_type: draft.channel === "email" ? "email" : "message", order: 1, day: 0, position: draft.position ?? 1, channel: draft.channel as "email" | "linkedin_message", label: "First touch" } as SequenceStep;
  const total = steps.filter((s) => s.track === step.track && s.position !== null).length || 1;
  const bundle = communityAi.getContactWithCompany(draft.target_id);
  if (!bundle) throw new Error("Contact not found");
  const others = db.prepare("SELECT channel, body FROM approval_queue WHERE target_id = ? AND id != ? AND status IN ('pending','approved') ORDER BY position").all(draft.target_id, draftId) as Array<{ channel: string; body: string }>;
  const next = await rewriteStep(agent, icp, step, total, { contact: bundle.contact, company: bundle.company, signals: strongestSignals(db, draft.target_id) },
    { subject: draft.subject, body: draft.body }, instruction?.trim() || null, others.map((o) => ({ label: o.channel, body: o.body.slice(0, 400) })));
  db.prepare("UPDATE approval_queue SET subject = ?, body = ?, updated_at = datetime('now') WHERE id = ?").run(next.subject, next.body, draftId);
  return db.prepare("SELECT id, step_id, channel, subject, body, status, auto_approve_at, position, updated_at FROM approval_queue WHERE id = ?").get(draftId) as DraftRow;
}

/** Contacts waiting in Copilot, best first, with a count of drafts and when autopilot sends. */
export function copilotQueue(db: Database.Database, workspaceId: string, agentId: string | null) {
  return db.prepare(`SELECT t.id, t.full_name, t.headline, t.title, t.company, t.profile_image_url, t.lead_score, t.fit_verdict, t.agent_id,
      a.name agent_name, a.mode agent_mode, COUNT(q.id) drafts, MIN(q.auto_approve_at) auto_approve_at, MIN(q.created_at) queued_at
    FROM approval_queue q JOIN targets t ON t.id = q.target_id LEFT JOIN agents a ON a.id = q.agent_id
    WHERE q.workspace_id = ? AND q.status = 'pending' AND (? IS NULL OR q.agent_id = ?)
    GROUP BY t.id ORDER BY t.lead_score DESC, queued_at LIMIT 300`).all(workspaceId, agentId, agentId);
}
