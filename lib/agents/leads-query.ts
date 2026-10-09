import type Database from "better-sqlite3";
import { isSignalType } from "@/lib/signals/types";

/**
 * The agent Leads feed: filter, sort, facet and page agent-sourced contacts.
 * Every user-supplied value is checked against an allowlist; SQL fragments below are
 * constants, and the only values bound from input are ids, the search text and the signal type.
 */

export const LEAD_STATUSES = ["all", "drafted", "scheduled", "in_sequence", "replied", "qualified", "needs_data", "disqualified", "skipped"] as const;
/** Older values still accepted (MCP leads_list, old links). "active" = everything not rejected. */
const LEGACY_STATUSES = ["active", "new", "approved", "enrolled"] as const;
export const LEAD_STEPS = ["not_contacted", "invitation_sent", "invitation_accepted", "invitation_withdrawn", "message_sent", "inmail_sent", "email_sent", "replied"] as const;
export const LEAD_APPROVALS = ["pending", "approved", "rejected"] as const;
export const EMAIL_ENRICH = ["found", "not_found", "not_enriched", "unsubscribed"] as const;
export const PHONE_ENRICH = ["found", "not_found", "not_enriched"] as const;
export const LEAD_SORTS = ["newest", "score_desc", "score_asc", "signal_desc", "signal_asc"] as const;
/** AI score bands, as the flames show them: 1 = first signs of interest (<50), 2 = actively exploring (50-69), 3 = ready to engage (70+). */
export const SCORE_BANDS = ["1", "2", "3"] as const;
const VERDICTS = ["strong", "possible", "poor"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number] | (typeof LEGACY_STATUSES)[number];
export type LeadStep = (typeof LEAD_STEPS)[number];
export type LeadApproval = (typeof LEAD_APPROVALS)[number];
export type EmailEnrich = (typeof EMAIL_ENRICH)[number];
export type PhoneEnrich = (typeof PHONE_ENRICH)[number];
export type LeadSort = (typeof LEAD_SORTS)[number];

export interface LeadsQuery {
  /** "agents" (default): agent-sourced leads only. "all": every contact in the workspace (Contacts page). */
  scope: "agents" | "all";
  agentId: string | null;
  /** A list id, or "none" for contacts in no list. */
  listId: string | null;
  scoreBand: (typeof SCORE_BANDS)[number] | null;
  replied: boolean;
  interested: boolean;
  /** created_at range, YYYY-MM-DD, inclusive. */
  from: string | null;
  to: string | null;
  status: LeadStatus;
  step: LeadStep | null;
  approval: LeadApproval | null;
  emailEnrich: EmailEnrich | null;
  phoneEnrich: PhoneEnrich | null;
  signalType: string | null;
  verdict: (typeof VERDICTS)[number] | null;
  q: string | null;
  sort: LeadSort;
  limit: number;
  offset: number;
  facets: boolean;
}

export type ParseResult = { ok: true; query: LeadsQuery } | { ok: false; error: string };

type Raw = Record<string, string | string[] | undefined>;

function one(raw: Raw, key: string): string {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

function pick<T extends string>(raw: Raw, key: string, allowed: readonly T[]): { value: T | null; error?: string } {
  const v = one(raw, key);
  if (!v) return { value: null };
  return (allowed as readonly string[]).includes(v) ? { value: v as T } : { value: null, error: `Unknown ${key}: ${v.slice(0, 40)}` };
}

/** Validate query-string params. Unknown values are rejected rather than ignored. */
export function parseLeadsQuery(raw: Raw): ParseResult {
  const status = pick(raw, "status", [...LEAD_STATUSES, ...LEGACY_STATUSES]);
  const step = pick(raw, "step", LEAD_STEPS);
  const approval = pick(raw, "approval", LEAD_APPROVALS);
  const email = pick(raw, "email_enrich", EMAIL_ENRICH);
  const phone = pick(raw, "phone_enrich", PHONE_ENRICH);
  const sort = pick(raw, "sort", LEAD_SORTS);
  const verdict = pick(raw, "verdict", VERDICTS);
  const err = [status, step, approval, email, phone, sort, verdict].find((p) => p.error)?.error;
  if (err) return { ok: false, error: err };
  const band = pick(raw, "score_band", SCORE_BANDS);
  if (band.error) return { ok: false, error: band.error };
  const date = (k: string) => { const v = one(raw, k); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const listId = one(raw, "list_id").slice(0, 100);
  const signalType = one(raw, "signal_type");
  if (signalType && !isSignalType(signalType)) return { ok: false, error: `Unknown signal_type: ${signalType.slice(0, 40)}` };
  const limitRaw = Number(one(raw, "limit") || 50);
  const offsetRaw = Number(one(raw, "offset") || 0);
  const q = one(raw, "q").slice(0, 100);
  return {
    ok: true,
    query: {
      scope: one(raw, "scope") === "all" ? "all" : "agents",
      agentId: one(raw, "agent_id") || null,
      listId: listId || null,
      scoreBand: band.value,
      replied: ["1", "true"].includes(one(raw, "replied")),
      interested: ["1", "true"].includes(one(raw, "interested")),
      from: date("from"),
      to: date("to"),
      status: status.value ?? "active",
      step: step.value, approval: approval.value, emailEnrich: email.value, phoneEnrich: phone.value,
      signalType: signalType || null, verdict: verdict.value, q: q || null,
      sort: sort.value ?? "score_desc",
      limit: Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50,
      offset: Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0,
      facets: ["1", "true"].includes(one(raw, "facets")),
    },
  };
}

// ─── SQL fragments (constants only) ────────────────────────────────────────────

const REPLIED = "(t.last_replied_at IS NOT NULL OR t.email_replied_at IS NOT NULL)";
const EMAIL_SENT = "EXISTS (SELECT 1 FROM sent_messages sm WHERE sm.target_id = t.id)";
/** Same marker lib/agents/loop.ts writes (EMAIL_ATTEMPT_PROVIDER), or an Apollo lookup. */
const EMAIL_ATTEMPTED = "(EXISTS (SELECT 1 FROM enrichment_cache ec WHERE ec.identity_key = 'target:' || t.id AND ec.provider = '_attempt') OR t.apollo_enriched_at IS NOT NULL)";
const UNSUBSCRIBED = "EXISTS (SELECT 1 FROM suppressions su WHERE su.workspace_id = t.workspace_id AND su.kind = 'email' AND su.value = lower(t.email))";
const NO_EMAIL = "(t.email IS NULL OR t.email = '')";
const NO_PHONE = "(t.phone IS NULL OR t.phone = '')";

export const STATUS_SQL: Record<Exclude<LeadStatus, "all">, string> = {
  active: "t.agent_status NOT IN ('disqualified','skipped')",
  new: "t.agent_status = 'new'",
  approved: "t.agent_status = 'approved'",
  enrolled: "t.agent_status = 'enrolled'",
  drafted: "t.agent_status = 'drafted'",
  scheduled: "t.agent_status = 'approved'",
  in_sequence: `t.agent_status = 'enrolled' AND NOT ${REPLIED}`,
  replied: REPLIED,
  qualified: "t.agent_status = 'qualified'",
  needs_data: "t.agent_status = 'needs_data'",
  disqualified: "t.agent_status = 'disqualified'",
  skipped: "t.agent_status = 'skipped'",
};

export const STEP_SQL: Record<LeadStep, string> = {
  not_contacted: `t.connection_requested_at IS NULL AND t.connected_at IS NULL AND t.message_sent_at IS NULL AND t.inmail_sent_at IS NULL AND NOT ${EMAIL_SENT}`,
  invitation_sent: "t.connection_requested_at IS NOT NULL AND t.connected_at IS NULL",
  invitation_accepted: "t.connected_at IS NOT NULL",
  invitation_withdrawn: "t.connection_requested_at IS NOT NULL AND t.connected_at IS NULL AND EXISTS (SELECT 1 FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id WHERE rp.target_id = t.id AND rt.error_message LIKE '%withdraw%')",
  message_sent: "t.message_sent_at IS NOT NULL",
  inmail_sent: "t.inmail_sent_at IS NOT NULL",
  email_sent: EMAIL_SENT,
  replied: REPLIED,
};

const APPROVAL_SQL: Record<LeadApproval, string> = {
  pending: "(t.agent_status = 'drafted' OR EXISTS (SELECT 1 FROM approval_queue aq WHERE aq.target_id = t.id AND aq.status = 'pending'))",
  approved: "t.agent_status IN ('approved','enrolled')",
  rejected: "t.agent_status = 'skipped'",
};

const EMAIL_SQL: Record<EmailEnrich, string> = {
  found: `NOT ${NO_EMAIL} AND NOT ${UNSUBSCRIBED}`,
  not_found: `${NO_EMAIL} AND ${EMAIL_ATTEMPTED}`,
  not_enriched: `${NO_EMAIL} AND NOT ${EMAIL_ATTEMPTED}`,
  unsubscribed: `NOT ${NO_EMAIL} AND ${UNSUBSCRIBED}`,
};

const PHONE_SQL: Record<PhoneEnrich, string> = {
  found: `NOT ${NO_PHONE}`,
  not_found: `${NO_PHONE} AND t.apollo_enriched_at IS NOT NULL`,
  not_enriched: `${NO_PHONE} AND t.apollo_enriched_at IS NULL`,
};

const SCORE = "COALESCE(t.lead_score, t.intent_score)";
const SCORE_BAND_SQL: Record<(typeof SCORE_BANDS)[number], string> = {
  // Unscored contacts carry intent_score 0, not NULL: they have no band.
  "1": `((t.lead_score IS NOT NULL OR t.intent_score > 0) AND ${SCORE} < 50)`,
  "2": `(${SCORE} >= 50 AND ${SCORE} < 70)`,
  "3": `(${SCORE} >= 70)`,
};
const SORT_SQL: Record<LeadSort, string> = {
  newest: "t.created_at DESC, t.id",
  score_desc: `${SCORE} IS NULL, ${SCORE} DESC, t.created_at DESC`,
  score_asc: `${SCORE} IS NULL, ${SCORE} ASC, t.created_at DESC`,
  signal_desc: "last_signal_at IS NULL, last_signal_at DESC, t.created_at DESC",
  signal_asc: "last_signal_at IS NULL, last_signal_at ASC, t.created_at DESC",
};

type Dimension = "status" | "step" | "signal";

/** WHERE clause for the query, optionally leaving one dimension out (for its facet counts). */
export function buildWhere(workspaceId: string, q: LeadsQuery, omit?: Dimension): { sql: string; params: unknown[] } {
  const where = ["t.workspace_id = ?"];
  if (q.scope !== "all") where.push("t.agent_id IS NOT NULL");
  const params: unknown[] = [workspaceId];
  if (q.agentId) { where.push("t.agent_id = ?"); params.push(q.agentId); }
  if (q.listId === "none") where.push("NOT EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id)");
  else if (q.listId) { where.push("EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id AND lt.list_id = ?)"); params.push(q.listId); }
  if (q.scoreBand) where.push(SCORE_BAND_SQL[q.scoreBand]);
  if (q.replied) where.push(REPLIED);
  if (q.interested) where.push("t.reply_kind = 'positive'");
  if (q.from) { where.push("date(t.created_at) >= ?"); params.push(q.from); }
  if (q.to) { where.push("date(t.created_at) <= ?"); params.push(q.to); }
  if (omit !== "status" && q.status !== "all") where.push(`(${STATUS_SQL[q.status]})`);
  if (omit !== "step" && q.step) where.push(`(${STEP_SQL[q.step]})`);
  if (q.approval) where.push(`(${APPROVAL_SQL[q.approval]})`);
  if (q.emailEnrich) where.push(`(${EMAIL_SQL[q.emailEnrich]})`);
  if (q.phoneEnrich) where.push(`(${PHONE_SQL[q.phoneEnrich]})`);
  if (q.verdict) { where.push("t.fit_verdict = ?"); params.push(q.verdict); }
  if (omit !== "signal" && q.signalType) { where.push("EXISTS (SELECT 1 FROM signals s WHERE s.target_id = t.id AND s.type = ?)"); params.push(q.signalType); }
  if (q.q) {
    const like = `%${q.q}%`;
    where.push("(t.full_name LIKE ? OR t.company LIKE ? OR t.headline LIKE ? OR t.email LIKE ?)"); params.push(like, like, like, like);
  }
  return { sql: where.join(" AND "), params };
}

// ─── facets ───────────────────────────────────────────────────────────────────

export interface LeadFacets {
  status: Record<(typeof LEAD_STATUSES)[number], number>;
  step: Record<"all" | LeadStep, number>;
  signal: Array<{ type: string; count: number }>;
}

function countEach<K extends string>(db: Database.Database, where: { sql: string; params: unknown[] }, cases: Array<[K, string | null]>): Record<K, number> {
  const cols = cases.map(([k, sql]) => sql ? `COALESCE(SUM(CASE WHEN ${sql} THEN 1 ELSE 0 END), 0) AS "${k}"` : `COUNT(*) AS "${k}"`);
  return db.prepare(`SELECT ${cols.join(", ")} FROM targets t WHERE ${where.sql}`).get(...where.params) as Record<K, number>;
}

/** Counts per option, each computed with every OTHER active filter applied. */
export function leadFacets(db: Database.Database, workspaceId: string, q: LeadsQuery): LeadFacets {
  const status = countEach(db, buildWhere(workspaceId, q, "status"), LEAD_STATUSES.map((s) => [s, s === "all" ? null : STATUS_SQL[s]] as [(typeof LEAD_STATUSES)[number], string | null]));
  const step = countEach(db, buildWhere(workspaceId, q, "step"), [["all", null] as ["all", null], ...LEAD_STEPS.map((s) => [s, STEP_SQL[s]] as [LeadStep, string])]);
  const w = buildWhere(workspaceId, q, "signal");
  const signal = db.prepare(`SELECT s.type, COUNT(DISTINCT t.id) count FROM targets t JOIN signals s ON s.target_id = t.id
    WHERE ${w.sql} GROUP BY s.type ORDER BY count DESC, s.type`).all(...w.params) as Array<{ type: string; count: number }>;
  return { status, step, signal };
}

// ─── outreach detail ──────────────────────────────────────────────────────────

export const OUTREACH_STEP_LABEL: Record<string, string> = { visit: "Profile visit", connect: "Invitation", message: "Message", sales_inmail: "InMail", email: "Email" };

export interface OutreachStepRef { type: string; order: number; label: string; accepted?: boolean }
export interface OutreachDetail {
  track: string;
  state: string;
  prev: OutreachStepRef | null;
  next: OutreachStepRef | null;
  waiting: string | null;
  next_at: string | null;
}

export interface TrackState { track: string; state: string; current_step: number; next_step_at: string | null }

function parseTime(s: string): number {
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

/**
 * Where a lead stands in its sequence. `stepTypes` is the track's steps in runner order
 * (current_step indexes it); delays are skipped when naming the previous and next step.
 */
export function computeOutreach(stepTypes: string[], tr: TrackState, connectedAt: string | null, now = Date.now()): OutreachDetail {
  const actions = stepTypes.map((type, idx) => ({ type, idx })).filter((s) => s.type !== "delay")
    .map((s, i) => ({ ...s, order: i + 1 }));
  const ref = (s: { type: string; order: number }): OutreachStepRef => ({ type: s.type, order: s.order, label: OUTREACH_STEP_LABEL[s.type] ?? s.type });
  const done = actions.filter((s) => s.idx < tr.current_step);
  const last = done[done.length - 1];
  const prev = last ? { ...ref(last), ...(last.type === "connect" && connectedAt ? { accepted: true } : {}) } : null;
  const live = tr.state === "in_progress" || tr.state === "pending";
  const upcoming = live ? actions.find((s) => s.idx >= tr.current_step) : undefined;
  const next = upcoming ? ref(upcoming) : null;
  let waiting: string | null = null;
  if (next && (next.type === "message" || next.type === "sales_inmail") && !connectedAt && done.some((s) => s.type === "connect")) {
    waiting = "Waiting for LinkedIn invitation acceptance.";
  } else if (next && tr.next_step_at && parseTime(tr.next_step_at) > now) {
    waiting = `Waiting until ${new Date(parseTime(tr.next_step_at)).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
  return { track: tr.track, state: tr.state, prev, next, waiting, next_at: next ? tr.next_step_at : null };
}

/** Outreach detail for each lead on a page: one track lookup per lead, step lists cached per workflow+track. */
export function outreachFor(db: Database.Database, leads: Array<{ id: string; connected_at: string | null }>): Map<string, OutreachDetail> {
  const trackStmt = db.prepare(`SELECT rt.track, rt.state, rt.current_step, rt.next_step_at, r.workflow_id
      FROM run_profile_tracks rt JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
     WHERE rp.target_id = ?
     ORDER BY rt.state = 'in_progress' DESC, COALESCE(rt.last_step_at, rt.created_at) DESC, rt.track = 'linkedin' DESC LIMIT 1`);
  const stepsStmt = db.prepare("SELECT step_type FROM workflow_steps WHERE workflow_id = ? AND track = ? ORDER BY step_order");
  const cache = new Map<string, string[]>();
  const out = new Map<string, OutreachDetail>();
  for (const l of leads) {
    const tr = trackStmt.get(l.id) as (TrackState & { workflow_id: string | null }) | undefined;
    if (!tr || !tr.workflow_id) continue;
    const key = `${tr.workflow_id}:${tr.track}`;
    if (!cache.has(key)) cache.set(key, (stepsStmt.all(tr.workflow_id, tr.track) as Array<{ step_type: string }>).map((s) => s.step_type));
    out.set(l.id, computeOutreach(cache.get(key)!, tr, l.connected_at));
  }
  return out;
}

// ─── list ─────────────────────────────────────────────────────────────────────

export interface LeadsResult {
  total: number;
  leads: Array<Record<string, unknown>>;
  facets?: LeadFacets;
}

export function listLeads(db: Database.Database, workspaceId: string, q: LeadsQuery): LeadsResult {
  const where = buildWhere(workspaceId, q);
  const total = (db.prepare(`SELECT COUNT(*) n FROM targets t WHERE ${where.sql}`).get(...where.params) as { n: number }).n;
  const rows = db.prepare(`SELECT t.id, t.full_name, t.first_name, t.headline, t.title, t.company, t.location, t.linkedin_url, t.email, t.email_status, t.phone,
        t.profile_image_url, t.fit_score, t.fit_verdict, t.fit_reason, t.fit_confidence, t.intent_score, t.lead_score, t.agent_id,
        t.agent_status, t.agent_status_at, t.skip_reason, t.lead_source, t.created_at, t.connected_at, a.name agent_name,
        CASE WHEN ${REPLIED} THEN 1 ELSE 0 END replied,
        CASE WHEN NOT ${NO_EMAIL} AND ${UNSUBSCRIBED} THEN 1 ELSE 0 END email_unsubscribed,
        (SELECT MAX(s.occurred_at) FROM signals s WHERE s.target_id = t.id) last_signal_at,
        (SELECT l.name FROM list_targets lt JOIN lists l ON l.id = lt.list_id WHERE lt.target_id = t.id ORDER BY l.created_at DESC LIMIT 1) list_name,
        (SELECT COUNT(*) FROM list_targets lt WHERE lt.target_id = t.id) list_count
      FROM targets t LEFT JOIN agents a ON a.id = t.agent_id
     WHERE ${where.sql}
     ORDER BY ${SORT_SQL[q.sort]} LIMIT ? OFFSET ?`).all(...where.params, q.limit, q.offset) as Array<Record<string, unknown> & { id: string; connected_at: string | null }>;
  const signalsStmt = db.prepare("SELECT id, type, title, snippet, source_url, metadata_json, occurred_at, weight FROM signals WHERE target_id = ? ORDER BY occurred_at DESC LIMIT 5");
  const signalCountStmt = db.prepare("SELECT COUNT(*) n FROM signals WHERE target_id = ?");
  const draftsStmt = db.prepare("SELECT id, channel, subject, body, status, auto_approve_at FROM approval_queue WHERE target_id = ? AND status = 'pending' ORDER BY created_at");
  const outreach = outreachFor(db, rows);
  const leads = rows.map((l) => {
    const o = outreach.get(l.id) ?? null;
    return {
      ...l,
      replied: !!l.replied,
      email_unsubscribed: !!l.email_unsubscribed,
      // Kept for older callers: the next step type of a sequence in progress.
      outreach_step: o && o.state === "in_progress" ? o.next?.type ?? null : null,
      outreach: o,
      signals: signalsStmt.all(l.id),
      signal_count: (signalCountStmt.get(l.id) as { n: number }).n,
      drafts: draftsStmt.all(l.id),
    };
  });
  return { total, leads, ...(q.facets ? { facets: leadFacets(db, workspaceId, q) } : {}) };
}
