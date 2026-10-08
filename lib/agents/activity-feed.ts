import type Database from "better-sqlite3";
import { SOURCE_TYPES, isSourceType } from "@/lib/signals/types";

/**
 * One agent's Activity feed, built from structured tables (never log text):
 *
 *   discovery  detector_runs of the agent's sources
 *   campaign   linkedin_actions (sent / failed / uncertain), sent_messages, failed email_jobs, and the
 *              per-lead timestamps on targets (accepted, replied, email found, qualified; invitation /
 *              message / InMail only for sends that predate linkedin_actions)
 *   setup      agent + source + campaign creation times and the agent's audit_logs
 *   website    website_visit signals for the agent or its leads
 *
 * The page is picked in SQL: a UNION ALL of narrow key rows ordered by time with LIMIT/OFFSET;
 * only the rows on the page are then hydrated (lead, run counts, source config).
 */

type DB = Database.Database;

export const ACTIVITY_CATEGORIES = ["website", "discovery", "campaign", "setup"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export const isActivityCategory = (v: unknown): v is ActivityCategory => typeof v === "string" && (ACTIVITY_CATEGORIES as readonly string[]).includes(v);

export type OutcomeTone = "positive" | "neutral" | "warning" | "negative";
export type OutcomeIcon = "invite" | "accepted" | "message" | "inmail" | "email" | "reply" | "enriched" | "qualified" | "visit" | "like" | "voice" | "withdraw" | "error" | "running" | "website";
/** Leading mark of a row with no lead: a source type, or a setup kind. */
export type ActivityMark = string;

export interface ActivityOutcome { text: string; tone: OutcomeTone; icon: OutcomeIcon | null; hint?: string }
export interface ActivityLead { id: string; name: string; photo: string | null }
export interface ActivityFeedItem {
  id: string; category: ActivityCategory; kind: string; at: string;
  title: string; subtitle: string | null; lead: ActivityLead | null; mark: ActivityMark | null;
  outcome: ActivityOutcome | null;
  /** Signal type the run's leads carry, for "View leads". */
  signal_type: string | null;
}
export type ActivityCounts = Record<"all" | ActivityCategory, number>;
export interface ActivityPage { items: ActivityFeedItem[]; total: number; counts: ActivityCounts }
export interface ActivityQuery { workspaceId: string; agentId: string; category?: ActivityCategory; limit?: number; offset?: number }

const QUALIFIED = "('qualified','approved','drafted','enrolled')";
const LEAD = "t.agent_id = @agent AND t.workspace_id = @ws";

/** Each category's key rows: cat, kind, ref, target_id, src_id, at, k2, note. */
const PARTS: Record<ActivityCategory, string[]> = {
  discovery: [
    `SELECT 'discovery' cat, 'run' kind, dr.id ref, NULL target_id, dr.agent_source_id src_id, datetime(COALESCE(dr.finished_at, dr.started_at)) at, NULL k2, dr.error note
      FROM detector_runs dr JOIN agent_sources s ON s.id = dr.agent_source_id WHERE s.agent_id = @agent AND s.workspace_id = @ws AND dr.workspace_id = @ws`,
  ],
  campaign: [
    `SELECT 'campaign', 'li_action', la.id, t.id, NULL, datetime(la.updated_at), la.type || ':' || la.status, la.last_error
      FROM linkedin_actions la JOIN targets t ON t.id = la.target_id WHERE ${LEAD} AND la.status IN ('sent','failed','uncertain')`,
    // Sends recorded only on targets (before linkedin_actions existed).
    `SELECT 'campaign', 'invite_sent', t.id, t.id, NULL, datetime(t.connection_requested_at), NULL, NULL FROM targets t
      WHERE ${LEAD} AND t.connection_requested_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM linkedin_actions la WHERE la.target_id = t.id AND la.type = 'connect')`,
    `SELECT 'campaign', 'message_sent', t.id, t.id, NULL, datetime(t.message_sent_at), NULL, NULL FROM targets t
      WHERE ${LEAD} AND t.message_sent_at IS NOT NULL AND t.inmail_sent_at IS NULL AND NOT EXISTS (SELECT 1 FROM linkedin_actions la WHERE la.target_id = t.id AND la.type = 'message')`,
    `SELECT 'campaign', 'inmail_sent', t.id, t.id, NULL, datetime(t.inmail_sent_at), NULL, NULL FROM targets t
      WHERE ${LEAD} AND t.inmail_sent_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM linkedin_actions la WHERE la.target_id = t.id AND la.type = 'inmail')`,
    `SELECT 'campaign', 'accepted', t.id, t.id, NULL, datetime(t.connected_at), NULL, NULL FROM targets t
      WHERE ${LEAD} AND t.connected_at IS NOT NULL AND t.connection_requested_at IS NOT NULL`,
    `SELECT 'campaign', 'replied', t.id, t.id, NULL, datetime(t.last_replied_at), NULL, NULL FROM targets t WHERE ${LEAD} AND t.last_replied_at IS NOT NULL`,
    `SELECT 'campaign', 'email_replied', t.id, t.id, NULL, datetime(t.email_replied_at), NULL, NULL FROM targets t WHERE ${LEAD} AND t.email_replied_at IS NOT NULL`,
    // When the email was found: the enrichment cache hit for this address, else the Apollo enrichment.
    `SELECT 'campaign', 'email_enriched', e.id, e.id, NULL, datetime(e.found_at), NULL, NULL FROM (
       SELECT t.id, COALESCE((SELECT MIN(ec.fetched_at) FROM enrichment_cache ec WHERE ec.identity_key = lower(t.linkedin_url) AND lower(ec.email) = lower(t.email)), t.apollo_enriched_at) found_at
       FROM targets t WHERE ${LEAD} AND COALESCE(t.email, '') != '') e WHERE e.found_at IS NOT NULL`,
    `SELECT 'campaign', 'qualified', t.id, t.id, NULL, datetime(COALESCE(t.scored_at, t.agent_status_at)), NULL, NULL FROM targets t
      WHERE ${LEAD} AND t.agent_status IN ${QUALIFIED}`,
    `SELECT 'campaign', 'email_sent', sm.id, t.id, NULL, datetime(sm.accepted_at), CASE WHEN sm.bounced_at IS NOT NULL THEN 'bounced' ELSE sm.status END, NULL
      FROM sent_messages sm JOIN targets t ON t.id = sm.target_id WHERE ${LEAD} AND sm.workspace_id = @ws`,
    `SELECT 'campaign', 'email_failed', ej.id, t.id, NULL, datetime(ej.updated_at), NULL, ej.last_error
      FROM email_jobs ej JOIN targets t ON t.id = ej.target_id WHERE ${LEAD} AND ej.workspace_id = @ws AND ej.status = 'failed'`,
  ],
  setup: [
    `SELECT 'setup', 'agent_created', a.id, NULL, NULL, datetime(a.created_at), NULL, NULL FROM agents a WHERE a.id = @agent AND a.workspace_id = @ws`,
    `SELECT 'setup', 'source_added', s.id, NULL, s.id, datetime(s.created_at), s.source_type, NULL FROM agent_sources s WHERE s.agent_id = @agent AND s.workspace_id = @ws`,
    `SELECT 'setup', 'campaign_created', w.id, NULL, NULL, datetime(w.created_at), NULL, w.name
      FROM agents a JOIN workflows w ON w.id = a.workflow_id WHERE a.id = @agent AND a.workspace_id = @ws AND w.workspace_id = @ws`,
    // agent.created is the agent's own created_at; a PATCH that only asked for the default campaign is campaign_created.
    `SELECT 'setup', 'audit', al.id, NULL, NULL, datetime(al.created_at), al.action, al.metadata_json FROM audit_logs al
      WHERE al.workspace_id = @ws AND al.entity_type = 'agent' AND al.entity_id = @agent
        AND al.action IN ('agent.updated','agent.sources_saved','agent.csv_import','agent.linkedin_import','agent.duplicated')
        AND NOT (al.action = 'agent.updated' AND json_valid(al.metadata_json) AND json_extract(al.metadata_json, '$.fields') = '["create_default_campaign"]')`,
    `SELECT 'setup', 'audit', al.id, NULL, NULL, datetime(al.created_at), al.action, al.metadata_json FROM audit_logs al
      WHERE al.workspace_id = @ws AND al.entity_type = 'workflow' AND al.action = 'workflow.updated'
        AND al.entity_id = (SELECT workflow_id FROM agents WHERE id = @agent AND workspace_id = @ws)`,
  ],
  website: [
    `SELECT 'website', 'visit', sg.id, sg.target_id, NULL, datetime(COALESCE(sg.occurred_at, sg.created_at)), NULL, sg.title FROM signals sg
      WHERE sg.workspace_id = @ws AND sg.type = 'website_visit'
        AND (sg.agent_id = @agent OR sg.target_id IN (SELECT t.id FROM targets t WHERE ${LEAD}))`,
  ],
};

/** Lookup indexes the feed's joins need. Created once per connection; harmless if they exist. */
const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_activity_la_target ON linkedin_actions(target_id, type)",
  "CREATE INDEX IF NOT EXISTS idx_activity_signals_run ON signals(detector_run_id)",
  "CREATE INDEX IF NOT EXISTS idx_activity_signals_type ON signals(workspace_id, type)",
  "CREATE INDEX IF NOT EXISTS idx_activity_sent_target ON sent_messages(target_id)",
  "CREATE INDEX IF NOT EXISTS idx_activity_jobs_target ON email_jobs(target_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_activity_audit_entity ON audit_logs(workspace_id, entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_activity_sources_agent ON agent_sources(agent_id)",
];
const indexed = new WeakSet<DB>();
function ensureIndexes(db: DB) {
  if (indexed.has(db)) return;
  indexed.add(db);
  for (const sql of INDEXES) {
    try { db.exec(sql); } catch { /* read-only or table missing: the feed still works, just slower */ }
  }
}

interface KeyRow { cat: ActivityCategory; kind: string; ref: string; target_id: string | null; src_id: string | null; at: string; k2: string | null; note: string | null }

/** A compound SELECT takes its column names from its first arm, so lead with an empty, named one. */
const HEAD = "SELECT NULL cat, NULL kind, NULL ref, NULL target_id, NULL src_id, NULL at, NULL k2, NULL note WHERE 0";
const unionOf = (cats: readonly ActivityCategory[]) => [HEAD, ...cats.flatMap((c) => PARTS[c])].join("\nUNION ALL\n");

export function listAgentActivity(db: DB, q: ActivityQuery): ActivityPage {
  ensureIndexes(db);
  const params = { ws: q.workspaceId, agent: q.agentId };
  const limit = Math.min(100, Math.max(1, Math.floor(q.limit ?? 50)));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));

  const counts: ActivityCounts = { all: 0, website: 0, discovery: 0, campaign: 0, setup: 0 };
  const grouped = db.prepare(`SELECT cat, COUNT(*) n FROM (${unionOf(ACTIVITY_CATEGORIES)}) WHERE at IS NOT NULL GROUP BY cat`).all(params) as Array<{ cat: ActivityCategory; n: number }>;
  for (const g of grouped) { counts[g.cat] = g.n; counts.all += g.n; }

  const cats = q.category ? [q.category] : ACTIVITY_CATEGORIES;
  const keys = db.prepare(`SELECT * FROM (${unionOf(cats)}) WHERE at IS NOT NULL ORDER BY at DESC, kind, ref DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as KeyRow[];
  return { items: hydrate(db, q, keys), total: q.category ? counts[q.category] : counts.all, counts };
}

/* ─── hydration ─────────────────────────────────────────────────────────────────────────── */

interface LeadRow { id: string; full_name: string | null; first_name: string | null; last_name: string | null; title: string | null; company: string | null; headline: string | null; profile_image_url: string | null }
interface RunRow { id: string; candidates: number; ingested: number; filtered: number; error: string | null; finished_at: string | null; qualified: number }
interface SourceRow { id: string; source_type: string; config_json: string | null }

function byIds<T extends { id: string }>(db: DB, sql: string, ids: Array<string | null>, extra: Record<string, unknown>): Map<string, T> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const named = Object.fromEntries(list.map((id, i) => [`id${i}`, id]));
  const rows = db.prepare(sql.replace("@ids", list.map((_, i) => `@id${i}`).join(","))).all({ ...extra, ...named }) as T[];
  return new Map(rows.map((r) => [r.id, r]));
}

function hydrate(db: DB, q: ActivityQuery, keys: KeyRow[]): ActivityFeedItem[] {
  const p = { ws: q.workspaceId, agent: q.agentId };
  const leads = byIds<LeadRow>(db, "SELECT id, full_name, first_name, last_name, title, company, headline, profile_image_url FROM targets WHERE workspace_id = @ws AND id IN (@ids)", keys.map((k) => k.target_id), { ws: p.ws });
  const runs = byIds<RunRow>(db, `SELECT dr.id, dr.candidates, dr.ingested, dr.filtered, dr.error, dr.finished_at,
      (SELECT COUNT(DISTINCT sg.target_id) FROM signals sg JOIN targets t ON t.id = sg.target_id
        WHERE sg.detector_run_id = dr.id AND t.agent_id = @agent AND t.agent_status IN ${QUALIFIED}) qualified
    FROM detector_runs dr WHERE dr.workspace_id = @ws AND dr.id IN (@ids)`, keys.filter((k) => k.kind === "run").map((k) => k.ref), p);
  const sources = byIds<SourceRow>(db, "SELECT id, source_type, config_json FROM agent_sources WHERE workspace_id = @ws AND id IN (@ids)", keys.map((k) => k.src_id), { ws: p.ws });

  return keys.map((k) => {
    const lead = k.target_id ? leads.get(k.target_id) : undefined;
    const base: ActivityFeedItem = {
      id: `${k.kind}:${k.ref}`, category: k.cat, kind: k.kind, at: `${k.at.replace(" ", "T")}Z`,
      title: lead ? leadName(lead) : "", subtitle: lead ? leadSubtitle(lead) : null,
      lead: lead ? { id: lead.id, name: leadName(lead), photo: lead.profile_image_url } : null,
      mark: null, outcome: null, signal_type: null,
    };
    if (k.kind === "run") return runItem(base, runs.get(k.ref), k.src_id ? sources.get(k.src_id) : undefined, k.note);
    if (k.cat === "campaign") return { ...base, outcome: campaignOutcome(k) };
    if (k.cat === "website") return { ...base, title: base.title || k.note || "Website visit", mark: lead ? null : "website", outcome: { text: "Visited your website", tone: "neutral", icon: "website" } };
    return setupItem(base, k, k.src_id ? sources.get(k.src_id) : undefined);
  });
}

function leadName(l: LeadRow): string {
  return l.full_name?.trim() || [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
}
function leadSubtitle(l: LeadRow): string | null {
  if (l.title && l.company) return `${l.title} at ${l.company}`;
  return l.title || l.headline || l.company || null;
}
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const failed = (reason: string | null, what: string): ActivityOutcome =>
  ({ text: `Failed: ${clip(reason?.trim() || what)}`, tone: "negative", icon: "error", hint: reason ? `${what} failed: ${reason}` : undefined });

/* ─── discovery ─────────────────────────────────────────────────────────────────────────── */

const SOURCE_NAME: Record<string, string> = {
  competitor_engagement: "Competitor engagement", influencer_engagement: "Industry experts", own_content_engagement: "People engaging with you",
  keyword_engagement: "Topic engagement", job_change: "Recent job changes", funding: "Recently raised funds", hiring: "Job openings",
  lookalike: "Lookalike prospects", existing_list: "Saved list", linkedin_import: "LinkedIn import",
};

function parseConfig(json: string | null): { urls: string[]; keywords: string[] } {
  try {
    const c = JSON.parse(json || "{}") as Record<string, unknown>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
    return { urls: strings(c.urls), keywords: strings(c.keywords) };
  } catch { return { urls: [], keywords: [] }; }
}
const more = (xs: string[]) => (xs.length > 1 ? ` +${xs.length - 1} more` : "");

/** What a source watches, the way the screenshot titles it: "topic", a URL, or the event name. */
export function sourceTitle(type: string, configJson: string | null): { title: string; subtitle: string | null } {
  const c = parseConfig(configJson);
  if (type === "keyword_engagement" && c.keywords.length) return { title: `"${c.keywords[0]}"${more(c.keywords)}`, subtitle: "Engagement & Interest" };
  if (type === "competitor_engagement" && c.urls.length) return { title: `${c.urls[0]}${more(c.urls)}`, subtitle: /\/company\//.test(c.urls[0]) ? "Company competitor profile" : "Competitor profile" };
  if (type === "influencer_engagement" && c.urls.length) return { title: `${c.urls[0]}${more(c.urls)}`, subtitle: "Industry expert" };
  if (type === "own_content_engagement" && c.urls.length) return { title: `${c.urls[0]}${more(c.urls)}`, subtitle: "Engagement with you" };
  return { title: SOURCE_NAME[type] ?? type, subtitle: null };
}

function runItem(base: ActivityFeedItem, run: RunRow | undefined, src: SourceRow | undefined, error: string | null): ActivityFeedItem {
  const type = src?.source_type ?? "";
  const { title, subtitle } = src ? sourceTitle(type, src.config_json) : { title: "Lead source (removed)", subtitle: null };
  const item = { ...base, title, subtitle, mark: type || "source" };
  if (error) return { ...item, outcome: failed(error, "Lead discovery") };
  if (!run || !run.finished_at) return { ...item, outcome: { text: "Running", tone: "neutral", icon: "running" } };
  const hint = `${run.candidates} found · ${run.ingested} new leads · ${run.filtered} filtered out · ${run.qualified} qualified`;
  const signal = isSourceType(type) ? SOURCE_TYPES[type].signal : null;
  if (!run.candidates) return { ...item, outcome: { text: "No new people found", tone: "neutral", icon: null, hint } };
  return {
    ...item, signal_type: run.ingested > 0 ? signal : null,
    outcome: { text: `${run.qualified} of ${run.candidates} matched`, tone: run.qualified > 0 ? "positive" : "neutral", icon: null, hint },
  };
}

/* ─── campaign ──────────────────────────────────────────────────────────────────────────── */

const ACTION: Record<string, { text: string; icon: OutcomeIcon; noun: string }> = {
  connect: { text: "Invitation sent", icon: "invite", noun: "Invitation" },
  message: { text: "Message sent", icon: "message", noun: "Message" },
  inmail: { text: "InMail sent", icon: "inmail", noun: "InMail" },
  visit: { text: "Profile visited", icon: "visit", noun: "Profile visit" },
  like: { text: "Post liked", icon: "like", noun: "Post like" },
  voice: { text: "Voice message sent", icon: "voice", noun: "Voice message" },
  withdraw: { text: "Invitation withdrawn", icon: "withdraw", noun: "Withdrawal" },
};

const FIXED: Record<string, ActivityOutcome> = {
  invite_sent: { text: "Invitation sent", tone: "neutral", icon: "invite" },
  message_sent: { text: "Message sent", tone: "neutral", icon: "message" },
  inmail_sent: { text: "InMail sent", tone: "neutral", icon: "inmail" },
  accepted: { text: "Invitation accepted", tone: "positive", icon: "accepted" },
  replied: { text: "Replied", tone: "positive", icon: "reply" },
  email_replied: { text: "Replied by email", tone: "positive", icon: "reply" },
  email_enriched: { text: "Email enriched", tone: "neutral", icon: "enriched" },
  qualified: { text: "Qualified", tone: "positive", icon: "qualified" },
};

function campaignOutcome(k: KeyRow): ActivityOutcome {
  if (k.kind === "li_action") {
    const [type, status] = (k.k2 ?? "").split(":");
    const a = ACTION[type] ?? { text: "LinkedIn action", icon: "invite" as OutcomeIcon, noun: "LinkedIn action" };
    if (status === "failed") return failed(k.note, a.noun);
    if (status === "uncertain") return { text: `${a.noun} not confirmed`, tone: "warning", icon: "error", hint: k.note ?? "Check LinkedIn to see whether it went out" };
    return { text: a.text, tone: "neutral", icon: a.icon };
  }
  if (k.kind === "email_sent") return k.k2 === "bounced" ? { text: "Email bounced", tone: "negative", icon: "error" } : { text: "Email sent", tone: "neutral", icon: "email" };
  if (k.kind === "email_failed") return failed(k.note, "Email");
  return FIXED[k.kind] ?? { text: k.kind, tone: "neutral", icon: null };
}

/* ─── setup ─────────────────────────────────────────────────────────────────────────────── */

const FIELD_LABEL: Record<string, string> = {
  status: "lead sourcing", outreach_enabled: "outreach", icp_id: "ICP", min_score: "minimum score", fit_weight: "fit weight",
  linkedin_account_id: "LinkedIn sender", email_account_id: "email sender", workflow_id: "campaign", list_id: "list", name: "name",
  daily_lead_cap: "daily lead cap", enrich_emails: "email enrichment", exclude_first_degree: "1st-degree exclusion", create_default_campaign: "campaign",
};
const humanize = (s: string) => FIELD_LABEL[s] ?? s.replace(/_/g, " ");
const sentence = (xs: string[]) => { const s = [...new Set(xs)].join(", "); return s ? s[0].toUpperCase() + s.slice(1) : null; };

function meta(json: string | null): Record<string, unknown> {
  try { const v = JSON.parse(json || "{}"); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
}
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function setupItem(base: ActivityFeedItem, k: KeyRow, src: SourceRow | undefined): ActivityFeedItem {
  if (k.kind === "agent_created") return { ...base, title: "Agent created", mark: "agent" };
  if (k.kind === "campaign_created") return { ...base, title: "Campaign created", subtitle: k.note, mark: "campaign" };
  if (k.kind === "source_added") {
    const type = src?.source_type ?? k.k2 ?? "";
    const s = sourceTitle(type, src?.config_json ?? null);
    return { ...base, title: "Lead source added", subtitle: s.title === (SOURCE_NAME[type] ?? type) ? s.title : `${SOURCE_NAME[type] ?? type} · ${s.title}`, mark: type || "source" };
  }
  const m = meta(k.note);
  switch (k.k2) {
    case "agent.updated":
      return { ...base, title: "Agent settings updated", subtitle: sentence(strs(m.fields).map(humanize)), mark: "settings" };
    case "agent.sources_saved":
      return { ...base, title: "Lead sources updated", subtitle: sentence(strs(m.types).map((t) => SOURCE_NAME[t] ?? t)), mark: "sources" };
    case "agent.csv_import": {
      const n = num(m.imported);
      return { ...base, title: "Contacts imported from CSV", mark: "csv", subtitle: num(m.duplicates) ? `${m.duplicates} duplicates skipped` : null,
        outcome: n === null ? null : { text: `${n} imported`, tone: n > 0 ? "positive" : "neutral", icon: null } };
    }
    case "agent.linkedin_import": {
      const n = num(m.imported) ?? num(m.count);
      return { ...base, title: "Contacts imported from LinkedIn", mark: "linkedin_import",
        outcome: n === null ? null : { text: `${n} ${num(m.imported) !== null ? "imported" : "requested"}`, tone: "neutral", icon: null } };
    }
    case "agent.duplicated": return { ...base, title: "Agent duplicated from another agent", mark: "agent" };
    case "workflow.updated": return { ...base, title: "Campaign updated", mark: "campaign" };
    default: return { ...base, title: k.k2 ?? "Setup change", mark: "settings" };
  }
}
