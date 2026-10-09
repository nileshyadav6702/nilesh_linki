import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { normalizeSuppression } from "@/lib/platform/suppression";

/**
 * Organization blocklist: companies (by website domain) and people (by LinkedIn profile) that
 * must never be contacted. Entries live in `suppressions` (kind 'domain' / 'linkedin'), which the
 * LinkedIn and email senders already refuse; agents also skip blocked leads before drafting.
 */

type DB = Database.Database;
export type BlockKind = "company" | "person";
const KIND: Record<BlockKind, "domain" | "linkedin"> = { company: "domain", person: "linkedin" };
export const MAX_ENTRIES_PER_REQUEST = 5000;

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROFILE_RE = /^linkedin\.com\/in\/[^/?#\s]{2,100}$/;

/** The stored value for an entry, or null when it isn't a valid domain / LinkedIn profile URL. */
export function normalizeEntry(kind: BlockKind, raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (kind === "company") {
    const d = normalizeSuppression("domain", value.replace(/^[a-z]+:\/\//i, "")).replace(/^www\./, "");
    // A LinkedIn (or other social) profile URL is not a company website.
    if (/(^|\.)(linkedin|facebook|twitter|x|instagram)\.com$/.test(d)) return null;
    return DOMAIN_RE.test(d) ? d : null;
  }
  const v = normalizeSuppression("linkedin", value).replace(/^[a-z]{2,3}\.linkedin\.com/, "linkedin.com");
  return PROFILE_RE.test(v) ? v : null;
}

export interface BlockEntryInput { value: string; label?: string | null }
export interface AddResult { added: number; existing: number; invalid: string[] }

export function addEntries(db: DB, ws: string, kind: BlockKind, entries: BlockEntryInput[], userId: string | null, source = "manual"): AddResult {
  const result: AddResult = { added: 0, existing: 0, invalid: [] };
  const insert = db.prepare(`INSERT INTO suppressions (id, workspace_id, kind, value, reason, source, created_by, label)
    VALUES (?, ?, ?, ?, 'Blocklisted', ?, ?, ?) ON CONFLICT(workspace_id, kind, value) DO UPDATE SET label = COALESCE(excluded.label, label)`);
  const exists = db.prepare("SELECT 1 FROM suppressions WHERE workspace_id = ? AND kind = ? AND value = ?");
  db.transaction(() => {
    const seen = new Set<string>();
    for (const e of entries.slice(0, MAX_ENTRIES_PER_REQUEST)) {
      const value = normalizeEntry(kind, e.value);
      if (!value) { if (e.value?.trim()) result.invalid.push(e.value.trim().slice(0, 200)); continue; }
      if (seen.has(value)) continue;
      seen.add(value);
      const label = e.label?.trim().slice(0, 200) || null;
      if (exists.get(ws, KIND[kind], value)) result.existing++;
      else result.added++;
      insert.run(randomUUID(), ws, KIND[kind], value, source, userId, label);
    }
  })();
  return result;
}

export interface BlockRow { id: string; value: string; label: string | null; source: string | null; created_at: string }

export function listEntries(db: DB, ws: string, kind: BlockKind, q: string, page: number, pageSize: number): { rows: BlockRow[]; total: number } {
  const like = `%${q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = "workspace_id = ? AND kind = ? AND (? = '%%' OR lower(value) LIKE ? ESCAPE '\\' OR lower(COALESCE(label, '')) LIKE ? ESCAPE '\\')";
  const args = [ws, KIND[kind], like, like, like];
  const total = (db.prepare(`SELECT COUNT(*) n FROM suppressions WHERE ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT id, value, label, source, created_at FROM suppressions WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, Math.max(0, page - 1) * pageSize) as BlockRow[];
  return { rows, total };
}

export function counts(db: DB, ws: string): Record<BlockKind, number> {
  const n = (k: string) => (db.prepare("SELECT COUNT(*) n FROM suppressions WHERE workspace_id = ? AND kind = ?").get(ws, k) as { n: number }).n;
  return { company: n("domain"), person: n("linkedin") };
}

export function removeEntries(db: DB, ws: string, kind: BlockKind, ids: string[]): number {
  const del = db.prepare("DELETE FROM suppressions WHERE id = ? AND workspace_id = ? AND kind = ?");
  return db.transaction(() => ids.slice(0, MAX_ENTRIES_PER_REQUEST).reduce((n, id) => n + del.run(id, ws, KIND[kind]).changes, 0))();
}

const csvCell = (v: string | null) => { const s = (v ?? "").replace(/^[=+\-@]/, "'$&"); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function entriesCsv(db: DB, ws: string, kind: BlockKind): string {
  const rows = db.prepare("SELECT value, label FROM suppressions WHERE workspace_id = ? AND kind = ? ORDER BY created_at DESC").all(ws, KIND[kind]) as Array<{ value: string; label: string | null }>;
  if (kind === "company") return ["website_domain,company_name", ...rows.map((r) => `${csvCell(r.value)},${csvCell(r.label)}`)].join("\n");
  return ["linkedin_url", ...rows.map((r) => csvCell(`https://www.${r.value}`))].join("\n");
}

/** A lead's company website domain (company record first, then its email domain). */
export function leadDomain(db: DB, targetId: string): string | null {
  const t = db.prepare(`SELECT t.email, c.domain, c.website FROM targets t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`).get(targetId) as
    { email: string | null; domain: string | null; website: string | null } | undefined;
  for (const raw of [t?.domain, t?.website]) { const d = raw ? normalizeEntry("company", raw) : null; if (d) return d; }
  return null;
}

/** Why a lead is on the manual blocklist, or null. */
export function blockedReason(db: DB, ws: string, targetId: string): string | null {
  const t = db.prepare("SELECT linkedin_url, email FROM targets WHERE id = ? AND workspace_id = ?").get(targetId, ws) as { linkedin_url: string | null; email: string | null } | undefined;
  if (!t) return null;
  const person = t.linkedin_url ? normalizeEntry("person", t.linkedin_url) : null;
  if (person && db.prepare("SELECT 1 FROM suppressions WHERE workspace_id = ? AND kind = 'linkedin' AND value = ?").get(ws, person)) return "This person is on your blocklist";
  const domains = [leadDomain(db, targetId), t.email?.split("@")[1] ? normalizeEntry("company", t.email.split("@")[1]) : null].filter(Boolean) as string[];
  for (const d of domains) {
    const row = db.prepare("SELECT label FROM suppressions WHERE workspace_id = ? AND kind = 'domain' AND value = ?").get(ws, d) as { label: string | null } | undefined;
    if (row) return `${row.label || d} is on your blocklist`;
  }
  return null;
}
