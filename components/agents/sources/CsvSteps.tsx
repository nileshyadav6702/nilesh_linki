import { useState, type ReactNode } from "react";
import { RiArrowRightLine, RiArrowRightSFill, RiInformationLine, RiLink } from "react-icons/ri";
import type { ParsedCsv } from "@/components/agents/sources/CsvImportModal";
import { customKeyFor, MANDATORY_FIELDS, OPTIONAL_FIELDS, type CsvFieldDef, type ReviewRow } from "@/lib/csv-rows";

/** Step 2 (map columns) and step 3 (review) of the CSV import modal. */

const selectCls = "h-10 w-full min-w-0 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15px] text-base-content outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]";

function Collapse({ title, meta, action, children, defaultOpen = false }: { title: string; meta: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-[0.06em] text-primary hover:opacity-80">
          <RiArrowRightSFill size={16} className={`text-base-content/60 transition-transform ${open ? "rotate-90" : ""}`} /> {title}
        </button>
        <span className="text-sm text-base-content/50">{meta}</span>
        {action}
      </div>
      {open && children}
    </div>
  );
}

export function MapStep({ csv, map, setMap, unmapped, custom, setCustom }: {
  csv: ParsedCsv; map: Record<string, string>; setMap: (m: Record<string, string>) => void; unmapped: string[];
  custom: Record<string, boolean>; setCustom: (c: Record<string, boolean>) => void;
}) {
  const sample = (h: string) => csv.rows.find((r) => (r[h] ?? "").trim())?.[h]?.trim() ?? "";
  // One column feeds one field: picking a column already used elsewhere moves it here.
  const setField = (key: string, header: string) => setMap(Object.fromEntries(Object.entries({ ...map, [key]: header }).map(([k, v]) => [k, k !== key && v === header && header ? "" : v])));
  const optionalMapped = OPTIONAL_FIELDS.filter((f) => map[f.key]).length;
  const enabled = unmapped.filter((h) => custom[h]).length;

  const row = (f: CsvFieldDef, required: boolean) => (
    <div key={f.key} className="grid grid-cols-[minmax(110px,180px)_16px_minmax(0,260px)] items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-0 sm:grid-cols-[minmax(140px,220px)_16px_minmax(0,280px)_1fr]">
      <label htmlFor={`map-${f.key}`} className="text-[15px] text-base-content">{f.label}{required && <span className="text-error"> *</span>}</label>
      <RiArrowRightLine size={14} className="text-base-content/40" aria-hidden="true" />
      <select id={`map-${f.key}`} className={selectCls} value={map[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}>
        <option value="">-- Not mapped --</option>
        {csv.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="hidden truncate text-[15px] text-base-content/40 sm:block">{map[f.key] && sample(map[f.key]) ? `e.g. ${sample(map[f.key])}` : f.key === "linkedin_url" && !map.linkedin_url ? "or map Email below" : ""}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[22px] font-semibold text-base-content">Map CSV columns</h3>
        <p className="mt-1 text-[15px] text-base-content/55">Match each contact field to a column from your file. Required fields are marked with an asterisk.</p>
        <p className="mt-1 text-[13px] text-base-content/45">{csv.name} · {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"} · {csv.headers.length} columns</p>
      </div>
      <div className="space-y-3">
        <div className="text-[14px] font-semibold uppercase tracking-[0.06em] text-base-content/60">Mandatory <span className="text-error">*</span></div>
        <div className="rounded-[12px] border border-[var(--border-subtle)]">{MANDATORY_FIELDS.map((f) => row(f, true))}</div>
      </div>
      <Collapse title="Optional" meta={`${optionalMapped} of ${OPTIONAL_FIELDS.length} mapped`}>
        <div className="rounded-[12px] border border-[var(--border-subtle)]">{OPTIONAL_FIELDS.map((f) => row(f, false))}</div>
      </Collapse>
      <Collapse title="Custom fields" meta={`${enabled} of ${unmapped.length} enabled`}
        action={unmapped.length > 0 && <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setCustom(Object.fromEntries(unmapped.map((h) => [h, enabled < unmapped.length])))}>{enabled < unmapped.length ? "Select all" : "Clear all"}</button>}>
        {unmapped.length ? (
          <div className="rounded-[12px] border border-[var(--border-subtle)]">
            {unmapped.map((h) => (
              <label key={h} className="flex cursor-pointer items-center gap-4 border-b border-[var(--border-subtle)] px-5 py-3 last:border-0 hover:bg-base-200/40">
                <input type="checkbox" className="checkbox checkbox-sm checkbox-primary rounded-[5px]" checked={!!custom[h]} onChange={(e) => setCustom({ ...custom, [h]: e.target.checked })} />
                <span className="w-[200px] truncate font-mono text-sm text-base-content">{h}</span>
                <RiArrowRightLine size={14} className="text-base-content/40" aria-hidden="true" />
                <span className="truncate rounded-[6px] bg-primary/10 px-2 py-1 font-mono text-xs text-base-content/60">{customKeyFor(h)}</span>
              </label>
            ))}
          </div>
        ) : <p className="text-sm text-base-content/45">Every column is mapped.</p>}
      </Collapse>
      <p className="text-[13px] text-base-content/55">Enabled columns are imported as custom fields on each contact and can be used later for personalization.</p>
    </div>
  );
}

const STATUS_PILL: Record<ReviewRow["status"], string> = {
  ready: "bg-success/12 text-[#3a8c4f]", duplicate: "bg-[#e8a55a]/15 text-[#b8742a]", skipped: "bg-error/10 text-error",
};
const PREVIEW = 8;

/** `bare`: only the counts and the rows (the new-agent wizard shows its own destination list and actions). */
export function ReviewStep({ rows, total, agentName, autoEnrichEmails, bare = false }: { rows: ReviewRow[]; total: number; agentName: string; autoEnrichEmails: boolean; bare?: boolean }) {
  const count = (s: ReviewRow["status"]) => rows.filter((r) => r.status === s).length;
  const stat = (label: string, n: number, cls: string) => (
    <div className={`rounded-[12px] border px-4 py-4 text-center ${cls}`}>
      <div className="text-[24px] tabular-nums">{n}</div>
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em]">{label}</div>
    </div>
  );
  // Problems first, so a skipped row is never hidden past the preview.
  const shown = [...rows].sort((a, b) => (a.status === "ready" ? 1 : 0) - (b.status === "ready" ? 1 : 0) || a.index - b.index).slice(0, PREVIEW);
  const listName = `${agentName} - CSV Import`;
  return (
    <div className="space-y-6">
      {!bare && <div>
        <h3 className="text-[22px] font-semibold text-base-content">Review and import</h3>
        <p className="mt-1 text-[15px] text-base-content/55">Check the rows below. Duplicates of contacts already in your workspace are merged on import, not created twice.</p>
      </div>}
      <div className="grid grid-cols-3 gap-3">
        {stat("Ready", count("ready"), "border-success/30 bg-success/10 text-[#2f7a43]")}
        {stat("Duplicates", count("duplicate"), "border-[#e8a55a]/40 bg-[#e8a55a]/12 text-[#a0601d]")}
        {stat("Skipped", count("skipped"), "border-error/25 bg-error/8 text-error")}
      </div>
      <div className="overflow-x-auto rounded-[12px] border border-[var(--border-subtle)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-base-200/50 text-[12px] font-semibold uppercase tracking-[0.06em] text-base-content/55">
            <tr><th className="px-5 py-3">Contact</th><th className="px-3 py-3">LinkedIn URL</th><th className="px-3 py-3">Company</th><th className="px-3 py-3">Custom</th><th className="px-5 py-3 text-right">Status</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.index} className="border-t border-[var(--border-subtle)]">
                <td className="px-5 py-3"><div className="text-[15px] text-base-content">{r.name}</div>{r.email && <div className="text-[13px] text-base-content/50">{r.email}</div>}</td>
                <td className="max-w-[240px] truncate px-3 py-3 font-mono text-xs text-base-content/75">{r.linkedinPath ?? "—"}</td>
                <td className="px-3 py-3 text-[15px] text-base-content/80">{r.company ?? ""}</td>
                <td className="px-3 py-3 text-[13px] text-base-content/55">{r.custom ? `${r.custom} field${r.custom === 1 ? "" : "s"}` : ""}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${STATUS_PILL[r.status]}`}>{r.status}</span>
                  {r.reason && <div className="mt-0.5 text-[12px] text-base-content/50">{r.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-[var(--border-subtle)] bg-base-200/40 px-5 py-2.5 text-[13px] text-base-content/55">
          {total > shown.length ? `${total - shown.length} more rows in this file · ${total} total` : `${total} total`}
        </div>
      </div>
      {!bare && <>
      <div className="flex items-start gap-4 rounded-[12px] border border-[var(--border-subtle)] px-5 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary"><RiLink size={18} /></span>
        <div>
          <div className="text-[15px] font-medium text-base-content">CSV Import will be added to <span className="text-primary">{agentName}</span></div>
          <p className="text-[13px] text-base-content/55">Contacts go to the list &quot;{listName}&quot; (created on your first CSV import for this agent), which is attached to this agent.</p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-[12px] bg-primary/5 px-5 py-4 text-[15px] text-base-content/75">
        <RiInformationLine size={18} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>Skipped rows stay in your file — nothing is deleted.</p>
          {autoEnrichEmails && <p className="font-medium text-base-content">Emails will be found for qualified leads that don&apos;t have one, because &quot;Find emails for qualified leads&quot; is on in this agent&apos;s settings.</p>}
        </div>
      </div>
      </>}
    </div>
  );
}
