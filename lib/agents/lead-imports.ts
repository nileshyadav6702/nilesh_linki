import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { attachListToAgent, LeadSourceError } from "@/lib/agents/lead-sources";
import { isSalesNavUrl, normalizeProfileUrlStrict, postActivityId } from "@/lib/agents/lead-source-rules";
import type { Agent } from "@/lib/agents/store";
import { CSV_MAX_BYTES } from "@/lib/csv-rows";
import { importCsvWithMapping, type ColumnMapping, type CsvImportWithMappingResult } from "@/lib/csv-import";
import { hasActiveImport, startImport } from "@/lib/import-jobs";
import type { Engager } from "@/lib/linkedin/engagers";
import { upsertLead } from "@/lib/signals/leads";

type DB = Database.Database;

/**
 * Imports that feed an agent (Lead sources drawer → "Import from…"). Each one fills a list and
 * attaches it to the agent's existing-list source, so the agent adopts the contacts on its
 * next pass exactly like a saved list.
 */

function ownList(db: DB, workspaceId: string, listId: string): { id: string; name: string } {
  const list = db.prepare("SELECT id, name FROM lists WHERE id = ? AND workspace_id = ?").get(listId, workspaceId) as { id: string; name: string } | undefined;
  if (!list) throw new LeadSourceError("List not found", 404);
  return list;
}

/** "<agent> - CSV Import", created once and reused by later CSV imports for the agent. */
export function csvImportList(db: DB, agent: Pick<Agent, "id" | "name" | "workspace_id">): { id: string; name: string } {
  const name = `${agent.name} - CSV Import`.slice(0, 200);
  const found = db.prepare("SELECT id, name FROM lists WHERE workspace_id = ? AND name = ? ORDER BY created_at LIMIT 1").get(agent.workspace_id, name) as { id: string; name: string } | undefined;
  if (found) return found;
  const id = randomUUID();
  db.prepare("INSERT INTO lists (id, workspace_id, name, description) VALUES (?, ?, ?, ?)").run(id, agent.workspace_id, name, `Contacts imported from CSV for the agent ${agent.name}`);
  return { id, name };
}

export interface AgentCsvResult extends CsvImportWithMappingResult { list_id: string; list_name: string }

/** CSV → "<agent> - CSV Import" list → attached to the agent. Rows need a first + last name and a LinkedIn URL or email. */
export function importAgentCsv(db: DB, agent: Agent, csv: string, mapping: ColumnMapping[]): AgentCsvResult {
  if (Buffer.byteLength(csv, "utf8") > CSV_MAX_BYTES) throw new LeadSourceError("CSV files are limited to 10MB", 413);
  const std = new Set(mapping.flatMap((m) => (m.kind === "standard" ? [m.field] : [])));
  if (!std.has("first_name") || !std.has("last_name")) throw new LeadSourceError("Map the First Name and Last Name columns");
  if (!std.has("linkedin_url") && !std.has("email")) throw new LeadSourceError("Map a LinkedIn Profile URL (or Email) column");
  const list = csvImportList(db, agent);
  const result = importCsvWithMapping(db, list.id, agent.workspace_id, csv, mapping, { requireName: true });
  attachListToAgent(db, agent.id, agent.workspace_id, list.id);
  return { ...result, list_id: list.id, list_name: list.name };
}

/** A LinkedIn account the workspace owns with a live session; anything else is refused. */
export function connectedAccount(db: DB, workspaceId: string, accountId: string): { id: string; name: string } {
  const acc = db.prepare("SELECT id, name, is_authenticated, cookies_json FROM accounts WHERE id = ? AND workspace_id = ?").get(accountId, workspaceId) as
    { id: string; name: string; is_authenticated: number; cookies_json: string | null } | undefined;
  if (!acc) throw new LeadSourceError("LinkedIn account not found", 404);
  if (!acc.is_authenticated || !acc.cookies_json) throw new LeadSourceError("This LinkedIn account is disconnected. Please select a connected LinkedIn account.");
  return { id: acc.id, name: acc.name };
}

/** Queue a paced Sales Navigator import (list, saved search or ad-hoc search) into a list, capped at `count`. */
export function startSalesNavImport(db: DB, agent: Agent, input: { url: string; count: number; account_id: string; list_id: string }): { import_id: string; list_id: string } {
  if (!isSalesNavUrl(input.url)) throw new LeadSourceError("Paste a Sales Navigator list or search URL (linkedin.com/sales/…)");
  const account = connectedAccount(db, agent.workspace_id, input.account_id);
  const list = ownList(db, agent.workspace_id, input.list_id);
  if (hasActiveImport(db, list.id)) throw new LeadSourceError("An import is already queued or running for this list", 409);
  db.prepare("UPDATE lists SET sales_nav_url = ? WHERE id = ?").run(input.url.trim(), list.id);
  const { importId } = startImport(db, { listId: list.id, accountId: account.id, salesNavUrl: input.url.trim(), enrich: false, cap: input.count });
  attachListToAgent(db, agent.id, agent.workspace_id, list.id);
  return { import_id: importId, list_id: list.id };
}

/** "jane-doe-4b1a2c3" → "Jane Doe": a readable placeholder until the profile is read. */
export function nameFromProfileUrl(url: string): string {
  const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
  const words = slug.split("-").filter(Boolean);
  if (words.length > 1 && /\d/.test(words[words.length - 1]) && words[words.length - 1].length >= 5) words.pop();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "LinkedIn member";
}

/** One LinkedIn profile → contact (deduped by profile URL) → list → agent. */
export function importSingleProfile(db: DB, agent: Agent, input: { profile_url: string; list_id: string }): { target_id: string; created: boolean; list_id: string } {
  const url = normalizeProfileUrlStrict(input.profile_url);
  if (!url) throw new LeadSourceError("Paste a LinkedIn profile URL (linkedin.com/in/…)");
  const list = ownList(db, agent.workspace_id, input.list_id);
  const result = db.transaction(() => {
    const r = upsertLead(db, agent.workspace_id, null, { name: nameFromProfileUrl(url), profileUrl: url }, "linkedin_profile");
    db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(list.id, r.targetId);
    attachListToAgent(db, agent.id, agent.workspace_id, list.id);
    return r;
  })();
  return { target_id: result.targetId, created: result.created, list_id: list.id };
}

export function postUrn(postUrl: string): string {
  const id = postActivityId(postUrl);
  if (!id) throw new LeadSourceError("Paste the URL of a LinkedIn post (it contains \"activity\")");
  return `urn:li:activity:${id}`;
}

export interface EngagerCounts { reactions: number; comments: number }
export const countEngagers = (list: Engager[]): EngagerCounts => ({ reactions: list.filter((e) => e.kind === "reaction").length, comments: list.filter((e) => e.kind === "comment").length });

/** Post engagers (already fetched under the account lease) → contacts → list → agent. */
export function importPostEngagers(db: DB, agent: Agent, listId: string, engagers: Engager[]): { imported: number; existing: number; list_id: string } {
  const list = ownList(db, agent.workspace_id, listId);
  let imported = 0, existing = 0;
  db.transaction(() => {
    const link = db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");
    for (const e of engagers) {
      if (!e.profileUrl && !e.memberUrn) continue;
      const r = upsertLead(db, agent.workspace_id, null, { name: e.name, firstName: e.firstName, lastName: e.lastName, headline: e.headline, profileUrl: e.profileUrl, memberUrn: e.memberUrn, profileImageUrl: e.imageUrl }, "linkedin_post");
      if (r.created) imported++; else existing++;
      link.run(list.id, r.targetId);
    }
    attachListToAgent(db, agent.id, agent.workspace_id, list.id);
  })();
  return { imported, existing, list_id: list.id };
}

/** A person read from a LinkedIn page (search results, profile visitors). */
export interface ImportPerson { name: string; profileUrl: string; headline?: string | null; title?: string | null; company?: string | null; location?: string | null; imageUrl?: string | null }

/** People → contacts in one of the workspace's lists, which is attached to the agent. */
export function importPeople(db: DB, agent: Agent, listId: string, people: ImportPerson[], source: string): { imported: number; existing: number; list_id: string } {
  const list = ownList(db, agent.workspace_id, listId);
  let imported = 0, existing = 0;
  db.transaction(() => {
    const link = db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");
    for (const p of people) {
      const r = upsertLead(db, agent.workspace_id, null, { name: p.name, headline: p.headline, profileUrl: p.profileUrl, title: p.title, company: p.company, location: p.location, profileImageUrl: p.imageUrl }, source);
      if (r.created) imported++; else existing++;
      link.run(list.id, r.targetId);
    }
    attachListToAgent(db, agent.id, agent.workspace_id, list.id);
  })();
  return { imported, existing, list_id: list.id };
}
