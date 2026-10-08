import Papa from "papaparse";
import type DatabaseType from "better-sqlite3";
import { randomUUID } from "crypto";
import { canonicalProfileUrl, EMAIL_RE, normalizeHeader } from "@/lib/csv-rows";

type DB = DatabaseType.Database;

// User-fillable target fields — everything else on `targets` (URNs, JSON blobs,
// enrichment timestamps, apollo/automation internals) is system-owned and not
// importable. Mirrors the PATCH /api/targets/[id] editable set.
const EDITABLE_FIELDS = [
  "first_name", "last_name", "title", "company", "location",
  "city", "country", "phone", "headline", "summary", "notes",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

// Company columns a CSV may carry on top of the editable set (mapping import only fills them
// when mapped; the plain template does not list them).
const IMPORT_FIELDS = [...EDITABLE_FIELDS, "company_linkedin_url", "company_industry"] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

// One template covers every case: a pure LinkedIn list, a pure email list (incl.
// generic inboxes like info@company.com), or an export that already has both
// (e.g. a list exported from another tool). Each row just needs linkedin_url
// and/or email filled in — whatever the contact actually has.
const TEMPLATE_COLUMNS = ["linkedin_url", "sales_nav_url", "email", ...EDITABLE_FIELDS] as const;

const SAMPLE_VALUES: Record<EditableField, string> = {
  first_name: "Jane",
  last_name: "Doe",
  title: "Head of Marketing",
  company: "Acme Inc",
  location: "Berlin, Germany",
  city: "Berlin",
  country: "Germany",
  phone: "+49 30 1234567",
  headline: "Head of Marketing @ Acme Inc",
  summary: "10+ years in B2B SaaS marketing.",
  notes: "Met at SaaStr 2026",
};

export function buildCsvTemplate(): string {
  const sample = TEMPLATE_COLUMNS.map((c) =>
    c === "linkedin_url" ? "https://www.linkedin.com/in/example-profile/" :
    c === "sales_nav_url" ? "" :
    c === "email" ? "jane@acme.com" :
    SAMPLE_VALUES[c as EditableField]
  );
  return Papa.unparse({ fields: [...TEMPLATE_COLUMNS], data: [sample] });
}

export interface CsvImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  /** Rows that matched a contact already in the workspace (or an earlier row): merged, not re-created. */
  duplicates: number;
}

// The full set of user-mappable standard target fields.
export const STANDARD_FIELDS = ["linkedin_url", "sales_nav_url", "email", ...IMPORT_FIELDS] as const;
export type StandardField = (typeof STANDARD_FIELDS)[number];

// Describes what each normalized CSV column becomes on import.
export type ColumnMapping =
  | { column: string; kind: "ignore" }
  | { column: string; kind: "standard"; field: StandardField }
  | { column: string; kind: "custom"; key: string; name: string; fieldType: "text" | "number" | "boolean" };

export interface CsvImportWithMappingResult extends CsvImportResult {
  customFieldsCreated: number;
}

// Same rule the platform custom-fields endpoint enforces for keys.
const CUSTOM_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Defensive shape validation for a user-supplied column mapping. */
export function validateMapping(input: unknown): { mapping: ColumnMapping[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "mapping must be an array" };
  if (input.length > 500) return { error: "too many mapped columns" };
  const out: ColumnMapping[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "each mapping entry must be an object" };
    const m = raw as Record<string, unknown>;
    if (typeof m.column !== "string" || !m.column || m.column.length > 200) return { error: "each mapping entry needs a column name" };
    if (m.kind === "ignore") {
      out.push({ column: m.column, kind: "ignore" });
    } else if (m.kind === "standard") {
      if (typeof m.field !== "string" || !(STANDARD_FIELDS as readonly string[]).includes(m.field)) return { error: `unknown standard field for column "${m.column}"` };
      out.push({ column: m.column, kind: "standard", field: m.field as StandardField });
    } else if (m.kind === "custom") {
      if (typeof m.key !== "string" || !CUSTOM_KEY_RE.test(m.key) || m.key.length > 80) return { error: `invalid variable key for column "${m.column}"` };
      const fieldType = m.fieldType === "number" || m.fieldType === "boolean" ? m.fieldType : "text";
      const name = typeof m.name === "string" && m.name ? m.name.slice(0, 120) : m.key;
      out.push({ column: m.column, kind: "custom", key: m.key, name, fieldType });
    } else {
      return { error: `invalid mapping kind for column "${m.column}"` };
    }
  }
  return { mapping: out };
}

interface ParsedRow {
  linkedin_url: string | null;
  sales_nav_url: string | null;
  email: string | null;
  full_name: string | null;
  fields: Record<ImportField, string | null>;
}

function get(row: Record<string, string>, key: string): string | null {
  const v = row[key];
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

const parseCsv = (csvText: string) => Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true, transformHeader: normalizeHeader });

/**
 * Shared contact upsert with workspace-level de-duplication: a contact is resolved by its
 * LinkedIn profile (URLs compared in canonical form, so "linkedin.com/in/Jane/" and
 * "https://www.linkedin.com/in/jane" are one person), then by email (case-insensitive) — so
 * the same person is never imported twice into a workspace. An existing match is updated in
 * place (missing fields filled), otherwise a new contact is created.
 */
function targetUpserter(db: DB, workspaceId: string) {
  const byUrl = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const t of db.prepare("SELECT id, linkedin_url, email FROM targets WHERE workspace_id = ? AND (linkedin_url IS NOT NULL OR email IS NOT NULL) ORDER BY created_at").all(workspaceId) as Array<{ id: string; linkedin_url: string | null; email: string | null }>) {
    const u = canonicalProfileUrl(t.linkedin_url);
    if (u && !byUrl.has(u)) byUrl.set(u, t.id);
    if (t.email && !byEmail.has(t.email.toLowerCase())) byEmail.set(t.email.toLowerCase(), t.id);
  }
  const insertFull = db.prepare(`
    INSERT INTO targets (id, workspace_id, linkedin_url, email, sales_nav_url, full_name, ${IMPORT_FIELDS.join(", ")})
    VALUES (?, ?, ?, ?, ?, ?, ${IMPORT_FIELDS.map(() => "?").join(", ")})
  `);
  // The stored LinkedIn URL is kept when present: rewriting it could collide with the unique index.
  const updateFull = db.prepare(`
    UPDATE targets SET
      linkedin_url = COALESCE(linkedin_url, ?),
      email = COALESCE(?, email),
      sales_nav_url = COALESCE(?, sales_nav_url),
      full_name = COALESCE(?, full_name),
      ${IMPORT_FIELDS.map((c) => `${c} = COALESCE(?, ${c})`).join(",\n      ")}
    WHERE id = ?
  `);
  const linkToList = db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");

  function resolveTarget(row: ParsedRow): { targetId: string; isNew: boolean } {
    const fieldValues = IMPORT_FIELDS.map((f) => row.fields[f]);
    const existing = (row.linkedin_url && byUrl.get(row.linkedin_url)) || (row.email && byEmail.get(row.email)) || null;
    if (existing) {
      updateFull.run(row.linkedin_url, row.email, row.sales_nav_url, row.full_name, ...fieldValues, existing);
      if (row.linkedin_url && !byUrl.has(row.linkedin_url)) byUrl.set(row.linkedin_url, existing);
      if (row.email && !byEmail.has(row.email)) byEmail.set(row.email, existing);
      return { targetId: existing, isNew: false };
    }
    const targetId = randomUUID();
    insertFull.run(targetId, workspaceId, row.linkedin_url, row.email, row.sales_nav_url, row.full_name, ...fieldValues);
    if (row.linkedin_url) byUrl.set(row.linkedin_url, targetId);
    if (row.email) byEmail.set(row.email, targetId);
    return { targetId, isNew: true };
  }

  return { resolveTarget, linkToList };
}

/**
 * Validate one CSV row into a ParsedRow, or return the reason it is skipped.
 * `requireName`: the agent import needs a first and last name on every contact.
 */
function parseRow(lookup: (field: StandardField) => string | null, rowNum: number, requireName: boolean): ParsedRow | string {
  const fields = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, lookup(f)])) as Record<ImportField, string | null>;
  if (requireName && (!fields.first_name || !fields.last_name)) return `Row ${rowNum}: missing first or last name`;
  const full_name = [fields.first_name, fields.last_name].filter(Boolean).join(" ") || null;

  const rawUrl = lookup("linkedin_url");
  const linkedin_url = rawUrl ? canonicalProfileUrl(rawUrl) : null;
  if (rawUrl && !linkedin_url) return `Row ${rowNum}: "${rawUrl}" is not a valid linkedin.com/in/ URL`;

  const rawEmail = lookup("email");
  let email: string | null = null;
  if (rawEmail) {
    if (!EMAIL_RE.test(rawEmail)) return `Row ${rowNum}: "${rawEmail}" is not a valid email`;
    email = rawEmail.toLowerCase();
  }
  if (!linkedin_url && !email) return `Row ${rowNum}: needs at least a linkedin_url or an email`;
  return { linkedin_url, sales_nav_url: lookup("sales_nav_url"), email, full_name, fields };
}

export function importCsv(db: DB, listId: string, workspaceId: string, csvText: string): CsvImportResult {
  const parsed = parseCsv(csvText);
  const errors: string[] = [];
  let imported = 0, updated = 0, skipped = 0, duplicates = 0;

  const rows: ParsedRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const row = parseRow((f) => get(raw, f), idx + 2, false); // header is row 1
    if (typeof row === "string") errors.push(row); else rows.push(row);
  });

  const { resolveTarget, linkToList } = targetUpserter(db, workspaceId);
  db.transaction(() => {
    for (const row of rows) {
      const { targetId, isNew } = resolveTarget(row);
      if (!isNew) duplicates++;
      const linkResult = linkToList.run(listId, targetId);
      if (linkResult.changes > 0) {
        if (isNew) imported++; else updated++;
      } else {
        skipped++; // already in this list, no changes
      }
    }
  })();

  return { imported, updated, skipped, errors, duplicates };
}

function parseBoolCell(raw: string): boolean {
  return /^(true|1|yes|y|t)$/i.test(raw.trim());
}

// Mapping-aware importer: standard columns populate target fields (same upsert
// + validation as importCsv), and "custom" columns are turned into
// custom_field_definitions (find-or-create by key) whose per-row cell values are
// written to contact_custom_values — usable as {{key}} merge tags in templates.
export function importCsvWithMapping(
  db: DB,
  listId: string,
  workspaceId: string,
  csvText: string,
  mapping: ColumnMapping[],
  opts: { requireName?: boolean } = {}
): CsvImportWithMappingResult {
  const parsed = parseCsv(csvText);

  // Reverse the mapping into fast lookups.
  const standardCol: Partial<Record<StandardField, string>> = {};
  const customCols: { column: string; key: string; name: string; fieldType: "text" | "number" | "boolean" }[] = [];
  const seenKeys = new Set<string>();
  for (const m of mapping) {
    if (m.kind === "standard") {
      standardCol[m.field] = m.column;
    } else if (m.kind === "custom") {
      if (!CUSTOM_KEY_RE.test(m.key)) continue; // skip invalid keys silently
      if (seenKeys.has(m.key)) continue; // first column wins for a given key
      seenKeys.add(m.key);
      customCols.push({ column: m.column, key: m.key, name: m.name || m.key, fieldType: m.fieldType });
    }
  }

  const errors: string[] = [];
  let imported = 0, updated = 0, skipped = 0, duplicates = 0;

  interface MappedRow extends ParsedRow {
    custom: Record<string, string | null>;
  }

  const rows: MappedRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const row = parseRow((f) => (standardCol[f] ? get(raw, standardCol[f]!) : null), idx + 2, !!opts.requireName);
    if (typeof row === "string") { errors.push(row); return; }
    const custom: Record<string, string | null> = {};
    for (const c of customCols) custom[c.key] = get(raw, c.column);
    rows.push({ ...row, custom });
  });

  const { resolveTarget, linkToList } = targetUpserter(db, workspaceId);

  const findDef = db.prepare("SELECT id, field_type FROM custom_field_definitions WHERE workspace_id = ? AND key = ?");
  const insertDef = db.prepare("INSERT INTO custom_field_definitions (id, workspace_id, name, key, field_type, options_json) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertValue = db.prepare(`INSERT INTO contact_custom_values (workspace_id, target_id, field_id, value_text, value_number, value_boolean, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(target_id, field_id) DO UPDATE SET
    value_text=excluded.value_text, value_number=excluded.value_number, value_boolean=excluded.value_boolean, updated_at=datetime('now')`);

  let customFieldsCreated = 0;

  db.transaction(() => {
    // Resolve (find-or-create) a definition per custom column up front.
    const resolved: { key: string; fieldId: string; fieldType: "text" | "number" | "boolean" }[] = [];
    for (const c of customCols) {
      const existing = findDef.get(workspaceId, c.key) as { id: string; field_type: string } | undefined;
      let fieldId: string;
      let fieldType: "text" | "number" | "boolean";
      if (existing) {
        fieldId = existing.id;
        // Existing definition is authoritative for how values are stored.
        fieldType = (["text", "number", "boolean"].includes(existing.field_type) ? existing.field_type : "text") as typeof fieldType;
      } else {
        fieldId = randomUUID();
        fieldType = c.fieldType;
        insertDef.run(fieldId, workspaceId, c.name, c.key, fieldType, JSON.stringify(null));
        customFieldsCreated++;
      }
      resolved.push({ key: c.key, fieldId, fieldType });
    }

    for (const row of rows) {
      const { targetId, isNew } = resolveTarget(row);
      if (!isNew) duplicates++;

      // Write custom personalization values for this contact.
      for (const r of resolved) {
        const cell = row.custom[r.key];
        if (cell === null || cell === undefined) continue; // skip empty cells
        let value_text: string | null = null;
        let value_number: number | null = null;
        let value_boolean: number | null = null;
        if (r.fieldType === "number") {
          const n = Number(cell);
          if (Number.isNaN(n)) continue; // skip non-numeric cells
          value_number = n;
        } else if (r.fieldType === "boolean") {
          value_boolean = parseBoolCell(cell) ? 1 : 0;
        } else {
          value_text = cell;
        }
        upsertValue.run(workspaceId, targetId, r.fieldId, value_text, value_number, value_boolean);
      }

      const linkResult = linkToList.run(listId, targetId);
      if (linkResult.changes > 0) {
        if (isNew) imported++; else updated++;
      } else {
        skipped++; // already in this list, no changes
      }
    }
  })();

  return { imported, updated, skipped, errors, duplicates, customFieldsCreated };
}
