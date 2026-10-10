import type DatabaseType from "better-sqlite3";

type DB = DatabaseType.Database;

interface CustomValueRow {
  key: string;
  field_type: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: number | null;
}

/** Coerce a stored EAV custom value into the string a template variable renders to. */
function coerce(row: CustomValueRow): string {
  if (row.field_type === "number") return row.value_number != null ? String(row.value_number) : "";
  if (row.field_type === "boolean") return row.value_boolean ? "yes" : "no";
  return row.value_text ?? "";
}

/**
 * Load a target's custom-field values as a `{ key: renderedString }` map, keyed
 * by the workspace's `custom_field_definitions.key` — ready to pass as the
 * `custom` argument of `renderOutreachTemplate`.
 */
export function loadTargetCustomValues(db: DB, workspaceId: string, targetId: string): Record<string, string> {
  const rows = db.prepare(`
    SELECT d.key AS key, d.field_type AS field_type,
           v.value_text AS value_text, v.value_number AS value_number, v.value_boolean AS value_boolean
    FROM contact_custom_values v
    JOIN custom_field_definitions d ON d.id = v.field_id
    WHERE v.workspace_id = ? AND v.target_id = ?
  `).all(workspaceId, targetId) as CustomValueRow[];

  // Sender variables first, so a workspace custom field of the same name wins.
  const map: Record<string, string> = { ...loadSenderValues(db, workspaceId, targetId) };
  for (const row of rows) map[row.key] = coerce(row);
  return map;
}

/** Sender variables ({{sender_first_name}} …): who the contact's agent sends as. */
export const SENDER_VARIABLE_KEYS = ["sender_first_name", "sender_name", "sender_full_name", "sender_company"] as const;

/**
 * The sender of a contact's outreach: the agent's LinkedIn account name (else its mailbox's from
 * name) and the company from the agent's ICP (else the workspace name). Empty when unknown.
 */
export function loadSenderValues(db: DB, workspaceId: string, targetId: string): Record<string, string> {
  const row = db.prepare(`SELECT COALESCE(NULLIF(TRIM(acc.name), ''), NULLIF(TRIM(ea.from_name), '')) name, icp.data_json icp, w.name workspace
    FROM targets t JOIN workspaces w ON w.id = t.workspace_id
    LEFT JOIN agents a ON a.id = t.agent_id
    LEFT JOIN accounts acc ON acc.id = a.linkedin_account_id
    LEFT JOIN email_accounts ea ON ea.id = a.email_account_id
    LEFT JOIN icps icp ON icp.id = a.icp_id
    WHERE t.id = ? AND t.workspace_id = ?`).get(targetId, workspaceId) as { name: string | null; icp: string | null; workspace: string | null } | undefined;
  if (!row) return {};
  let company = "";
  try { company = String((JSON.parse(row.icp ?? "{}") as { company_name?: string }).company_name ?? "").trim(); } catch { /* no ICP */ }
  const full = (row.name ?? "").trim();
  return { sender_first_name: full.split(/\s+/)[0] ?? "", sender_name: full, sender_full_name: full, sender_company: company || (row.workspace ?? "").trim() };
}
