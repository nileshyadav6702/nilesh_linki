import type Database from "better-sqlite3";
import { z } from "zod";
import { addSource, listSources, parseSourceConfig, sourceConfigSchema, updateSource, type AgentSource } from "@/lib/agents/store";
import { launchNow } from "@/lib/signals/scheduler";
import {
  countSignals, DRAWER_SIGNAL_TYPES, MAX_TOPIC_WORDS, normalizeCompanyUrl, normalizePageUrl, normalizeProfileUrlStrict, SIGNAL_BUDGET,
  type DrawerSignalType, type SignalDraft,
} from "@/lib/agents/lead-source-rules";

type DB = Database.Database;

const urlList = z.array(z.string().trim().min(1).max(400)).max(25);
const draftConfigSchema = z.object({
  urls: urlList.optional(),
  keywords: z.array(z.string().trim().min(2).max(80)).max(15).optional(),
  boards: z.array(z.object({ ats: z.enum(["greenhouse", "lever", "ashby"]), slug: z.string().trim().min(1).max(120), company: z.string().trim().max(160).optional() })).max(40).optional(),
  role_keywords: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
}).strict();

/** PUT /api/agents/:id/sources body: the drawer's staged changes. */
export const leadSourcesSaveSchema = z.object({
  sources: z.array(z.object({ source_type: z.enum(DRAWER_SIGNAL_TYPES), enabled: z.boolean(), config: draftConfigSchema.default({}) })).max(DRAWER_SIGNAL_TYPES.length).default([]),
  attach_list_ids: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  detach_list_ids: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});
export type LeadSourcesSave = z.infer<typeof leadSourcesSaveSchema>;

export class LeadSourceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = "LeadSourceError"; }
}

/** Canonical URLs for a URL-based source; throws a readable error on the first bad one. */
function cleanUrls(type: DrawerSignalType, urls: string[]): string[] {
  const norm = type === "competitor_engagement" || type === "company_followers" ? normalizeCompanyUrl : type === "influencer_engagement" ? normalizeProfileUrlStrict : normalizePageUrl;
  const what = type === "competitor_engagement" || type === "company_followers" ? "LinkedIn company page" : type === "influencer_engagement" ? "LinkedIn profile" : "LinkedIn profile or company page";
  const out: string[] = [];
  for (const u of urls) {
    const n = norm(u);
    if (!n) throw new LeadSourceError(`"${u}" is not a ${what} URL`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function checkDraft(type: DrawerSignalType, s: { enabled: boolean; config: z.infer<typeof draftConfigSchema> }): SignalDraft {
  const config = { ...s.config };
  if (config.urls) config.urls = cleanUrls(type, config.urls);
  if (config.keywords) {
    config.keywords = [...new Set(config.keywords.map((k) => k.replace(/\s+/g, " ")))];
    const long = config.keywords.find((k) => k.split(" ").length > MAX_TOPIC_WORDS);
    if (long) throw new LeadSourceError(`"${long}" has more than ${MAX_TOPIC_WORDS} words`);
  }
  if (s.enabled) {
    const needsUrls = type === "competitor_engagement" || type === "influencer_engagement" || type === "own_content_engagement";
    if (needsUrls && !config.urls?.length) throw new LeadSourceError("Add at least one LinkedIn page before turning this source on");
    if (type === "keyword_engagement" && !config.keywords?.length) throw new LeadSourceError("Add at least one topic");
    if (type === "hiring" && !config.boards?.length) throw new LeadSourceError("Job openings needs at least one job board (e.g. greenhouse:acme)");
    if (type === "tech_stack" && !config.keywords?.length) throw new LeadSourceError("Add at least one technology to track");
    if (type === "company_followers" && !config.urls?.length) throw new LeadSourceError("Add your company page to track its followers");
  }
  return { enabled: s.enabled, config };
}

function drafts(rows: AgentSource[]): Partial<Record<string, SignalDraft>> {
  const out: Partial<Record<string, SignalDraft>> = {};
  for (const r of rows) if (!out[r.source_type]) out[r.source_type] = { enabled: !!r.enabled, config: parseSourceConfig(r.config_json) };
  return out;
}

/** Add a list to the agent's "existing list" source (creating it), so the agent adopts its members. */
export function attachListToAgent(db: DB, agentId: string, workspaceId: string, listId: string): AgentSource {
  if (!db.prepare("SELECT 1 FROM lists WHERE id = ? AND workspace_id = ?").get(listId, workspaceId)) throw new LeadSourceError("List not found", 404);
  const own = db.prepare("SELECT list_id FROM agents WHERE id = ? AND workspace_id = ?").get(agentId, workspaceId) as { list_id: string | null } | undefined;
  if (!own) throw new LeadSourceError("Agent not found", 404);
  if (own.list_id === listId) throw new LeadSourceError("This is the agent's own lead list");
  const row = listSources(agentId, workspaceId).find((s) => s.source_type === "existing_list");
  if (!row) return addSource(agentId, workspaceId, "existing_list", { list_ids: [listId] });
  const config = parseSourceConfig(row.config_json);
  if (!config.list_ids.includes(listId)) {
    if (config.list_ids.length >= 20) throw new LeadSourceError("An agent can use at most 20 lists");
    config.list_ids.push(listId);
  }
  const updated = updateSource(row.id, workspaceId, { config, enabled: true })!;
  // Adopt the new members on the next pass instead of waiting out the interval.
  launchNow(db, row.id, listId);
  return updated;
}

function detachList(db: DB, agentId: string, workspaceId: string, listId: string): void {
  const row = listSources(agentId, workspaceId).find((s) => s.source_type === "existing_list");
  if (!row) return;
  const config = parseSourceConfig(row.config_json);
  config.list_ids = config.list_ids.filter((id) => id !== listId);
  updateSource(row.id, workspaceId, { config, enabled: config.list_ids.length > 0 ? !!row.enabled : false });
}

/**
 * Persist the drawer: one row per source type (config merged over the stored one, so knobs the
 * drawer does not show survive), plus list attach/detach on the existing-list source. All or nothing.
 */
export function saveLeadSources(db: DB, agentId: string, workspaceId: string, input: LeadSourcesSave): AgentSource[] {
  const rows = listSources(agentId, workspaceId);
  const before = drafts(rows);
  const next = { ...before };
  const checked = input.sources.map((s) => ({ type: s.source_type, draft: checkDraft(s.source_type, s) }));
  for (const c of checked) next[c.type] = { enabled: c.draft.enabled, config: { ...(before[c.type]?.config ?? {}), ...c.draft.config } };
  const was = countSignals(before);
  const now = countSignals(next);
  if (now > SIGNAL_BUDGET && now > was) throw new LeadSourceError(`An agent can track up to ${SIGNAL_BUDGET} signals (this would be ${now})`);
  // Hiring surge watches the job boards listed under Job openings.
  if (next.hiring_surge?.enabled && !next.hiring?.config.boards?.length) throw new LeadSourceError("Hiring surge watches the job boards under Job openings: add at least one board there");

  for (const id of input.attach_list_ids) {
    if (!db.prepare("SELECT 1 FROM lists WHERE id = ? AND workspace_id = ?").get(id, workspaceId)) throw new LeadSourceError("List not found", 404);
  }

  db.transaction(() => {
    for (const c of checked) {
      const row = rows.find((r) => r.source_type === c.type);
      const config = sourceConfigSchema.parse(next[c.type]!.config);
      if (row) updateSource(row.id, workspaceId, { config, enabled: c.draft.enabled });
      else if (c.draft.enabled) addSource(agentId, workspaceId, c.type, config);
    }
    for (const id of input.attach_list_ids) attachListToAgent(db, agentId, workspaceId, id);
    for (const id of input.detach_list_ids) detachList(db, agentId, workspaceId, id);
  })();
  return listSources(agentId, workspaceId);
}
