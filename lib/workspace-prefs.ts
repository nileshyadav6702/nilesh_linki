import type Database from "better-sqlite3";

/** Workspace-level switches stored in app_settings ("wspref:<name>:<workspace>"). */

export type WorkspacePref = "company_dedup";
const DEFAULTS: Record<WorkspacePref, boolean> = { company_dedup: false };
const key = (name: WorkspacePref, ws: string) => `wspref:${name}:${ws}`;

export function getWorkspacePref(db: Database.Database, ws: string, name: WorkspacePref): boolean {
  const v = (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key(name, ws)) as { value: string } | undefined)?.value;
  return v === undefined ? DEFAULTS[name] : v === "1";
}

export function setWorkspacePref(db: Database.Database, ws: string, name: WorkspacePref, on: boolean) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key(name, ws), on ? "1" : "0");
}

/** Company dedup: another lead from the same company is already being contacted in this workspace. */
export function companyAlreadyInOutreach(db: Database.Database, ws: string, lead: { id: string; company: string | null; company_id: string | null }): boolean {
  if (!lead.company_id && !lead.company?.trim()) return false;
  return !!db.prepare(`SELECT 1 FROM targets t WHERE t.workspace_id = ? AND t.id != ?
      AND ((? IS NOT NULL AND t.company_id = ?) OR (? != '' AND lower(trim(t.company)) = ?))
      AND (t.agent_status IN ('drafted','approved','enrolled') OR t.connection_requested_at IS NOT NULL OR t.message_sent_at IS NOT NULL)
    LIMIT 1`).get(ws, lead.id, lead.company_id, lead.company_id, lead.company?.trim().toLowerCase() ?? "", lead.company?.trim().toLowerCase() ?? "");
}
