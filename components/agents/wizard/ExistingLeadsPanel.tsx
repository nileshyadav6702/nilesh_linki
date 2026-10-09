import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiCheckboxCircleFill, RiFileTextLine, RiListUnordered, RiLoader4Line } from "react-icons/ri";
import { csvMapping, parseFile, type ParsedCsv } from "@/components/agents/sources/CsvImportModal";
import { MapStep, ReviewStep } from "@/components/agents/sources/CsvSteps";
import { Modal, SearchSelect } from "@/components/agents/sources/kit";
import { Collapse } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";
import { autoMap, reviewRows } from "@/lib/csv-rows";

/** Existing leads inside the Sources step: feed the agent an existing list, or import a CSV into one first. */

interface ListRow { id: string; name: string; target_count: number }
const NEW_LIST = "__new__";

/** Lists with lead counts; lists that are already an agent's own lead list are struck through. */
function useLists() {
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/lists").then((r) => r.json()).then((l) => setLists(Array.isArray(l) ? l : [])).catch(() => setLists([]));
    fetch("/api/agents").then((r) => r.json()).then((a) => setUsed(new Set((Array.isArray(a) ? a : []).map((x: { list_id: string | null }) => x.list_id).filter(Boolean) as string[]))).catch(() => {});
  }, []);
  return { lists, used, add: (l: ListRow) => setLists((cur) => [l, ...(cur ?? [])]) };
}

function ListPicker({ value, onChange, lists, used, onCreated, label = "Lead list" }: {
  value: string; onChange: (id: string) => void; lists: ListRow[] | null; used: Set<string>; onCreated: (l: ListRow) => void; label?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const options = [
    ...(lists ?? []).map((l) => ({
      value: l.id, label: `${l.name} (${l.target_count} lead${l.target_count === 1 ? "" : "s"})`,
      disabled: used.has(l.id), note: used.has(l.id) ? "— Already used" : undefined,
    })),
    { value: NEW_LIST, label: "Create a new list" },
  ];

  async function create() {
    setSaving(true);
    try {
      const r = await fetch("/api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not create the list");
      const row = { id: d.id as string, name: d.name as string, target_count: 0 };
      onCreated(row);
      onChange(row.id);
      setCreating(false); setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the list");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-2">
      <div className="text-[15px] font-medium">{label} <span className="text-error">*</span></div>
      <div className="sm:max-w-[420px]">
        <SearchSelect label={label} value={value} options={options} placeholder={lists === null ? "Loading lists…" : "Select or create a list"}
          onChange={(v) => (v === NEW_LIST ? setCreating(true) : onChange(v))} />
      </div>
      {creating && (
        <Modal labelId="new-list-title" title="Create a new List" subtitle="Imported and selected contacts are added to it." wide={false} onClose={() => !saving && setCreating(false)}
          footer={<>
            <button type="button" onClick={() => setCreating(false)} disabled={saving} className="h-10 rounded-[8px] px-4 text-sm font-medium text-base-content/75 hover:bg-base-200">Cancel</button>
            <button type="button" onClick={create} disabled={saving || !name.trim()} className="h-10 rounded-[8px] bg-primary px-4 text-sm font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">{saving ? "Creating…" : "Create list"}</button>
          </>}>
          <form className="space-y-2 px-6 py-6" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
            <label htmlFor="new-list-name" className="text-[15px] font-medium">List Name <span className="text-error">*</span></label>
            <input id="new-list-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter a name for your list"
              className="h-12 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Choice({ on, onClick, icon, title, text, children }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-[16px] border transition-colors duration-200 ${on ? "border-primary/25 bg-primary/[0.05]" : "border-[var(--border-subtle)] bg-base-100"}`}>
      <button type="button" role="radio" aria-checked={on} onClick={onClick} className="flex w-full items-center gap-5 px-6 py-6 text-left">
        <span className="shrink-0 text-base-content">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block text-[17px] font-medium">{title}</span><span className="block text-[17px] text-base-content/60">{text}</span></span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all ${on ? "border-primary/70 shadow-[0_0_0_4px_rgba(217,119,87,0.15)]" : "border-primary/60"}`}>
          {on && <span className="h-4 w-4 rounded-full bg-primary" />}
        </span>
      </button>
      <Collapse open={on}><div className="border-t border-[var(--border-subtle)] px-6 py-6">{children}</div></Collapse>
    </section>
  );
}

function CsvFlow({ state, set, lists, used, onCreated }: {
  state: WizardState; set: (p: Partial<WizardState>) => void; lists: ListRow[] | null; used: Set<string>; onCreated: (l: ListRow) => void;
}) {
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [size, setSize] = useState(0);
  const [map, setMap] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [reviewing, setReviewing] = useState(false);
  const [dest, setDest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = state.existing.csvImported;

  const usedCols = new Set(Object.values(map).filter(Boolean));
  const unmapped = (csv?.headers ?? []).filter((h) => !usedCols.has(h));
  const customOn = unmapped.filter((h) => custom[h]);
  const rows = csv && reviewing ? reviewRows(csv.rows, map, customOn) : [];
  const ready = rows.filter((r) => r.status === "ready").length;
  const canReview = !!map.first_name && !!map.last_name && (!!map.linkedin_url || !!map.email) && !!dest;

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseFile(file);
      setCsv(parsed); setSize(file.size); setMap(autoMap(parsed.headers)); setCustom({}); setReviewing(false);
      set({ existing: { ...state.existing, csvImported: null } });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this file"); }
  }

  async function runImport() {
    if (!csv || !dest) return;
    setImporting(true);
    try {
      const r = await fetch(`/api/lists/${dest}/import-csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csv.text, mapping: csvMapping(map, customOn) }) });
      const d = await r.json().catch(() => ({ error: r.status === 413 ? "This CSV is too large. Split it into smaller files." : "Import failed" }));
      if (!r.ok) { toast.error(d.error ?? "Import failed"); return; }
      const listName = lists?.find((l) => l.id === dest)?.name ?? "your list";
      // New contacts plus ones already in the workspace that were added to the list.
      const imported = (Number(d.imported) || 0) + (Number(d.updated) || 0);
      set({ listIds: [dest], existing: { ...state.existing, csvImported: { listId: dest, listName, imported } } });
      toast.success(`Imported ${imported} contact${imported === 1 ? "" : "s"} into "${listName}"`);
    } catch {
      toast.error("Import failed. Check your connection and try again.");
    } finally { setImporting(false); }
  }

  if (done) {
    return (
      <div className="wizard-rise flex items-center gap-4 rounded-[12px] border border-success/30 bg-success/10 px-5 py-4">
        <RiCheckboxCircleFill size={26} className="shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-medium">Imported {done.imported} contact{done.imported === 1 ? "" : "s"} into &quot;{done.listName}&quot;</div>
          <div className="text-[15px] text-base-content/60">Click Next to set up outreach. This list will feed your agent.</div>
        </div>
        <button type="button" onClick={() => { setCsv(null); setReviewing(false); set({ listIds: [], existing: { ...state.existing, csvImported: null } }); }} className="text-[15px] font-medium hover:underline">Import another file</button>
      </div>
    );
  }

  if (!csv) {
    return (
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-14 text-center transition-colors ${drag ? "border-primary/60 bg-primary/10" : "border-primary/20 hover:bg-primary/[0.04]"}`}>
        <p className="text-[17px] font-medium">Drop your CSV file or click to browse your computer</p>
        <p className="text-[14px] text-base-content/55">Max size: 10MB</p>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-5 py-4">
        <div className="min-w-0 flex-1"><div className="truncate text-[17px] font-medium">{csv.name}</div><div className="text-[14px] text-base-content/55">{(size / 1024).toFixed(2)} KB</div></div>
        <button type="button" onClick={() => input.current?.click()} className="text-[15px] font-medium hover:underline">Replace</button>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      {reviewing
        ? <ReviewStep rows={rows} total={csv.rows.length} agentName="" autoEnrichEmails={false} bare />
        : <MapStep csv={csv} map={map} setMap={setMap} unmapped={unmapped} custom={custom} setCustom={setCustom} />}

      <ListPicker label="Destination list" value={dest} onChange={setDest} lists={lists} used={used} onCreated={onCreated} />

      <div className="flex items-center justify-end gap-3">
        {reviewing ? (
          <>
            <button type="button" disabled={importing} onClick={() => setReviewing(false)} className="inline-flex h-11 items-center gap-1 rounded-[8px] px-4 text-[15px] font-medium hover:bg-base-200"><RiArrowLeftSLine size={18} /> Back</button>
            <button type="button" disabled={!ready || !dest || importing} onClick={runImport}
              className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">
              {importing ? <><RiLoader4Line size={16} className="animate-spin" /> Importing…</> : `Import ${ready} contact${ready === 1 ? "" : "s"}`}
            </button>
          </>
        ) : (
          <button type="button" disabled={!canReview} onClick={() => setReviewing(true)} title={!dest ? "Choose a destination list" : undefined}
            className="h-11 rounded-[8px] bg-primary px-5 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">Continue to review</button>
        )}
      </div>
    </div>
  );
}

export default function ExistingLeadsPanel({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { lists, used, add } = useLists();
  const mode = state.existing.mode;
  const choose = (m: "list" | "csv") => set({ existing: { ...state.existing, mode: m }, listIds: m === "csv" && state.existing.csvImported ? [state.existing.csvImported.listId] : [] });

  return (
    <div role="radiogroup" aria-label="Existing leads" className="space-y-5">
      <Choice on={mode === "list"} onClick={() => choose("list")} icon={<RiFileTextLine size={32} />} title="From a list" text="Pick an existing lead list">
        <ListPicker value={state.listIds[0] ?? ""} onChange={(id) => set({ listIds: [id] })} lists={lists} used={used} onCreated={add} />
        {state.listIds[0] && <p className="mt-3 text-[14px] text-base-content/55">The agent picks up this list&apos;s contacts on its first run. A contact already handled by another agent stays with that agent.</p>}
      </Choice>
      <Choice on={mode === "csv"} onClick={() => choose("csv")} icon={<RiListUnordered size={32} />} title="CSV import" text="Upload a CSV file with your leads">
        <CsvFlow state={state} set={set} lists={lists} used={used} onCreated={add} />
      </Choice>
    </div>
  );
}
