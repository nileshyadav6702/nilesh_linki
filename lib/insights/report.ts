import type Database from "better-sqlite3";
import { signalLabel } from "@/lib/signals/types";

/**
 * Insights: what is working across agents, lead sources and campaign steps for one period.
 * Every count is "leads", not events: a lead counts once per metric, on the day it first happened.
 *  - found: the lead was added to an agent.
 *  - contacted: first connection request, LinkedIn message, InMail, voice message or email.
 *  - messaged (reply-rate base): got a message; a connection request counts only with a note.
 *  - replied: first reply on LinkedIn or email. interested: a reply marked positive (or in the inbox).
 */

export interface Period { from: string; to: string } // inclusive, YYYY-MM-DD (UTC)
export interface Counts { found: number; contacted: number; messaged: number; replied: number; interested: number }
export interface DayPoint { day: string; found: number; contacted: number; replied: number; interested: number }
export interface AgentRow extends Counts { id: string; name: string; status: string }
export type SourceCategory = "buying_events" | "topic" | "competitor" | "influencer" | "own_content" | "website" | "lookalike" | "imported" | "other";
export interface SourceRow { key: string; name: string; category: SourceCategory; leads: number; replied: number; interested: number }
export interface StepRow { id: string; n: number; type: string; label: string; sent: number; accepted: number | null; replied: number }
export interface ChannelRow { channel: "linkedin" | "email"; sent: number; messaged: number; replied: number; steps: StepRow[] }
export interface InsightsReport {
  period: Period; agentId: string | null;
  overview: Counts; series: DayPoint[];
  agents: AgentRow[]; sources: SourceRow[]; channels: ChannelRow[];
}

interface LeadRaw {
  id: string; agent_id: string; created_at: string; lead_source: string | null; reply_kind: string | null;
  connection_requested_at: string | null; message_sent_at: string | null; inmail_sent_at: string | null;
  last_replied_at: string | null; email_replied_at: string | null; email_at: string | null; li_msg_at: string | null; inbox_interested: number;
}
interface Lead { id: string; agentId: string; source: string | null; found: string; contacted: string | null; messaged: string | null; replied: string | null; repliedAt: string | null; interested: boolean; liReplied: string | null; emailReplied: string | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE = new Set(["positive", "interested", "meeting"]);
const day = (ts: string | null | undefined) => (ts ? ts.slice(0, 10) : null);
const earliest = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).map((x) => x.replace(" ", "T")).sort()[0] ?? null;

/** Default and validated period: last `days` days ending today, or the given range (max 366 days). */
export function parsePeriod(from: unknown, to: unknown, days = 30): Period {
  const today = new Date().toISOString().slice(0, 10);
  const back = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  let f = typeof from === "string" && DAY.test(from) ? from : back;
  let t = typeof to === "string" && DAY.test(to) ? to : today;
  if (f > t) [f, t] = [t, f];
  const span = (Date.parse(t) - Date.parse(f)) / 86_400_000;
  if (span > 365) f = new Date(Date.parse(t) - 365 * 86_400_000).toISOString().slice(0, 10);
  return { from: f, to: t };
}

export function periodDays(p: Period): string[] {
  const out: string[] = [];
  for (let d = Date.parse(`${p.from}T00:00:00Z`); d <= Date.parse(`${p.to}T00:00:00Z`); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

function loadLeads(db: Database.Database, workspaceId: string, agentId: string | null): Lead[] {
  // Agents whose connection request carries a note (written or AI): that request counts as a message.
  const noted = new Set((db.prepare(`SELECT DISTINCT a.id FROM agents a JOIN workflow_steps ws ON ws.workflow_id = a.workflow_id
    WHERE a.workspace_id = ? AND ws.step_type = 'connect' AND COALESCE(ws.enabled, 1) = 1 AND (COALESCE(ws.connect_note, '') != '' OR ws.ai_enabled = 1)`)
    .all(workspaceId) as Array<{ id: string }>).map((r) => r.id));
  const rows = db.prepare(`SELECT t.id, t.agent_id, t.created_at, t.lead_source, t.reply_kind, t.connection_requested_at, t.message_sent_at, t.inmail_sent_at,
      t.last_replied_at, t.email_replied_at,
      (SELECT MIN(ej.updated_at) FROM email_jobs ej WHERE ej.target_id = t.id AND ej.status = 'sent') email_at,
      (SELECT MIN(la.updated_at) FROM linkedin_actions la WHERE la.target_id = t.id AND la.status = 'sent' AND la.type IN ('message','inmail','voice')) li_msg_at,
      EXISTS (SELECT 1 FROM inbox_threads it WHERE it.target_id = t.id AND it.interested = 1 AND it.deleted = 0) inbox_interested
    FROM targets t JOIN agents a ON a.id = t.agent_id
    WHERE a.workspace_id = ? AND (? IS NULL OR t.agent_id = ?)`).all(workspaceId, agentId, agentId) as LeadRaw[];
  return rows.map((r) => {
    const repliedAt = earliest(r.last_replied_at, r.email_replied_at);
    return {
      id: r.id, agentId: r.agent_id, source: r.lead_source, found: day(r.created_at)!,
      contacted: day(earliest(r.connection_requested_at, r.message_sent_at, r.inmail_sent_at, r.email_at, r.li_msg_at)),
      messaged: day(earliest(r.message_sent_at, r.inmail_sent_at, r.email_at, r.li_msg_at, noted.has(r.agent_id) ? r.connection_requested_at : null)),
      replied: day(repliedAt), repliedAt,
      interested: !!repliedAt && (POSITIVE.has(r.reply_kind ?? "") || !!r.inbox_interested),
      liReplied: day(r.last_replied_at), emailReplied: day(r.email_replied_at),
    };
  });
}

const within = (p: Period) => (d: string | null) => !!d && d >= p.from && d <= p.to;

function count(leads: Lead[], p: Period): Counts {
  const inP = within(p);
  const c: Counts = { found: 0, contacted: 0, messaged: 0, replied: 0, interested: 0 };
  for (const l of leads) {
    if (inP(l.found)) c.found++;
    if (inP(l.contacted)) c.contacted++;
    if (inP(l.messaged)) c.messaged++;
    if (inP(l.replied)) { c.replied++; if (l.interested) c.interested++; }
  }
  return c;
}

function series(leads: Lead[], p: Period): DayPoint[] {
  const points = new Map(periodDays(p).map((d) => [d, { day: d, found: 0, contacted: 0, replied: 0, interested: 0 }]));
  for (const l of leads) {
    const hit = (d: string | null, k: keyof Omit<DayPoint, "day">) => { const pt = d ? points.get(d) : undefined; if (pt) pt[k]++; };
    hit(l.found, "found"); hit(l.contacted, "contacted"); hit(l.replied, "replied");
    if (l.interested) hit(l.replied, "interested");
  }
  return [...points.values()];
}

const CATEGORY: Record<string, SourceCategory> = {
  funding: "buying_events", job_change: "buying_events", hiring: "buying_events", technology: "buying_events", product_intent: "buying_events",
  keyword_engagement: "topic", competitor_engagement: "competitor", influencer_engagement: "influencer", own_content_engagement: "own_content",
  website_visit: "website", lookalike: "lookalike",
};
const EVENT_NAME: Record<string, string> = { funding: "Recently raised funds", job_change: "Recently changed jobs", hiring: "Company is hiring" };
const IMPORT_NAME: Record<string, string> = { list: "From a list", imported: "Imported leads", csv: "CSV import", linkedin: "LinkedIn import", lookalike: "Warm lookalike" };
const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Reacted to a post about "x"" → x; "Reacted to Clay Run's post" → Clay Run; else the signal's label. */
export function sourceName(type: string, title: string | null): string {
  const t = title ?? "";
  if (type === "keyword_engagement") { const m = t.match(/"([^"]+)"/); if (m) return m[1]; }
  if (/_engagement$/.test(type)) { const m = t.match(/(?:to|on|with)\s+(.+?)['’]s\s+post/i); if (m) return m[1]; }
  return EVENT_NAME[type] ?? signalLabel(type);
}

/** "https://www.linkedin.com/company/clay-run/" → "clay-run" (shown until a signal brings the page name). */
const pageSlug = (url: string) => url.replace(/\/+$/, "").split("/").pop() ?? url;

function sources(db: Database.Database, workspaceId: string, agentIds: string[], leads: Lead[], p: Period): SourceRow[] {
  const inP = within(p);
  const rows = new Map<string, SourceRow>();
  // A configured page shows as its URL path until a signal brings the page's real name.
  const row = (category: SourceCategory, name: string, shown = name, named = true) => {
    const key = `${category}:${slugKey(name)}`;
    const r = rows.get(key);
    if (!r) rows.set(key, { key, name: shown, category, leads: 0, replied: 0, interested: 0 });
    else if (named) r.name = shown;
    return rows.get(key)!;
  };
  // Configured topics and pages show even before they bring a lead.
  if (agentIds.length) {
    const cfg = db.prepare(`SELECT source_type, config_json FROM agent_sources WHERE agent_id IN (${agentIds.map(() => "?").join(",")})`).all(...agentIds) as Array<{ source_type: string; config_json: string | null }>;
    for (const s of cfg) {
      const c = (() => { try { return JSON.parse(s.config_json ?? "{}") as { keywords?: string[]; urls?: string[] }; } catch { return {}; } })();
      const cat = CATEGORY[s.source_type] ?? "other";
      if (s.source_type === "keyword_engagement") for (const k of c.keywords ?? []) row(cat, k);
      else if (/_engagement$/.test(s.source_type)) for (const u of c.urls ?? []) row(cat, pageSlug(u), `/company/${pageSlug(u)}`, false);
      else if (EVENT_NAME[s.source_type]) row(cat, EVENT_NAME[s.source_type]);
    }
  }
  const best = new Map((db.prepare(`SELECT target_id, type, title FROM (
      SELECT s.target_id, s.type, s.title, ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY COALESCE(s.weight, s.score) DESC, s.occurred_at DESC) rn
      FROM signals s WHERE s.workspace_id = ? AND s.target_id IS NOT NULL) WHERE rn = 1`).all(workspaceId) as Array<{ target_id: string; type: string; title: string | null }>)
    .map((s) => [s.target_id, s]));
  for (const l of leads) {
    const found = inP(l.found), replied = inP(l.replied);
    if (!found && !replied) continue;
    const s = best.get(l.id);
    const r = s ? row(CATEGORY[s.type] ?? "other", sourceName(s.type, s.title))
      : row(l.source === "lookalike" ? "lookalike" : "imported", IMPORT_NAME[l.source ?? ""] ?? "Imported leads");
    if (found) r.leads++;
    if (replied) { r.replied++; if (l.interested) r.interested++; }
  }
  return [...rows.values()].sort((a, b) => b.leads - a.leads || b.replied - a.replied || a.name.localeCompare(b.name));
}

const STEP_LABEL: Record<string, string> = {
  connect: "Connection request", message: "LinkedIn message", sales_inmail: "InMail", inmail: "InMail", voice: "Voice message",
  visit: "Visit profile", like_posts: "Like posts", email: "Email",
};

function channels(db: Database.Database, agentId: string, leads: Lead[], p: Period): ChannelRow[] {
  const wf = (db.prepare("SELECT workflow_id FROM agents WHERE id = ?").get(agentId) as { workflow_id: string | null } | undefined)?.workflow_id;
  if (!wf) return [];
  const steps = db.prepare(`SELECT id, track, step_type FROM workflow_steps WHERE workflow_id = ? AND COALESCE(enabled, 1) = 1 AND step_type != 'delay' ORDER BY track, step_order`)
    .all(wf) as Array<{ id: string; track: string; step_type: string }>;
  if (!steps.length) return [];
  const inP = within(p);
  // Every send of this agent's campaign: which step, which lead, when.
  const sends = db.prepare(`SELECT la.step_id, la.target_id, la.updated_at at FROM linkedin_actions la JOIN targets t ON t.id = la.target_id
      WHERE t.agent_id = ? AND la.status = 'sent' AND la.step_id IS NOT NULL
    UNION ALL SELECT ej.step_id, ej.target_id, ej.updated_at FROM email_jobs ej JOIN targets t ON t.id = ej.target_id
      WHERE t.agent_id = ? AND ej.status = 'sent' AND ej.step_id IS NOT NULL`).all(agentId, agentId) as Array<{ step_id: string; target_id: string; at: string }>;
  const connected = new Set((db.prepare("SELECT id FROM targets WHERE agent_id = ? AND connected_at IS NOT NULL").all(agentId) as Array<{ id: string }>).map((r) => r.id));
  const byLead = new Map<string, Array<{ step: string; at: string }>>();
  for (const s of sends) { const a = byLead.get(s.target_id) ?? []; a.push({ step: s.step_id, at: s.at.replace(" ", "T") }); byLead.set(s.target_id, a); }

  const sent = new Map<string, Set<string>>();
  for (const s of sends) if (inP(day(s.at))) { const set = sent.get(s.step_id) ?? new Set(); set.add(s.target_id); sent.set(s.step_id, set); }
  // A reply is credited to the last step the lead got before replying.
  const repliedBy = new Map<string, number>();
  for (const l of leads) {
    if (!inP(l.replied) || !l.repliedAt) continue;
    const last = (byLead.get(l.id) ?? []).filter((x) => x.at <= l.repliedAt!).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (last) repliedBy.set(last.step, (repliedBy.get(last.step) ?? 0) + 1);
  }
  const trackOf = new Map(steps.map((s) => [s.id, s.track]));
  const out: ChannelRow[] = [];
  for (const ch of ["linkedin", "email"] as const) {
    const own = steps.filter((s) => (ch === "email" ? s.track === "email" : s.track !== "email"));
    if (!own.length) continue;
    const leadsSent = new Set<string>();
    for (const s of sends) if (trackOf.get(s.step_id) && (trackOf.get(s.step_id) === "email") === (ch === "email") && inP(day(s.at))) leadsSent.add(s.target_id);
    const replied = leads.filter((l) => inP(ch === "email" ? l.emailReplied : l.liReplied)).length;
    out.push({
      channel: ch, sent: leadsSent.size, replied,
      messaged: leads.filter((l) => inP(l.messaged) && (byLead.get(l.id) ?? []).some((x) => (trackOf.get(x.step) === "email") === (ch === "email"))).length,
      steps: own.map((s, i) => {
        const got = sent.get(s.id) ?? new Set<string>();
        return {
          id: s.id, n: i + 1, type: s.step_type, label: STEP_LABEL[s.step_type] ?? s.step_type.replace(/_/g, " "),
          sent: got.size, accepted: s.step_type === "connect" ? [...got].filter((id) => connected.has(id)).length : null, replied: repliedBy.get(s.id) ?? 0,
        };
      }),
    });
  }
  return out;
}

export function insightsReport(db: Database.Database, workspaceId: string, opts: { agentId?: string | null; period: Period }): InsightsReport {
  const agentId = opts.agentId ?? null;
  const p = opts.period;
  const agentList = db.prepare(`SELECT id, name, status FROM agents WHERE workspace_id = ? AND (? IS NULL OR id = ?) ORDER BY created_at`)
    .all(workspaceId, agentId, agentId) as Array<{ id: string; name: string; status: string }>;
  const leads = loadLeads(db, workspaceId, agentId);
  const byAgent = new Map<string, Lead[]>();
  for (const l of leads) { const a = byAgent.get(l.agentId) ?? []; a.push(l); byAgent.set(l.agentId, a); }
  return {
    period: p, agentId,
    overview: count(leads, p),
    series: series(leads, p),
    agents: agentId ? [] : agentList.map((a) => ({ id: a.id, name: a.name, status: a.status, ...count(byAgent.get(a.id) ?? [], p) })),
    sources: sources(db, workspaceId, agentList.map((a) => a.id), leads, p),
    channels: agentId ? channels(db, agentId, leads, p) : [],
  };
}
