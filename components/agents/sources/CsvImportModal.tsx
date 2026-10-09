import { useRef, useState, type DragEvent } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiCheckboxCircleLine, RiCheckLine, RiCodeSSlashLine, RiInformationLine, RiLink, RiLoader4Line, RiAddLine, RiUploadCloud2Line, RiUpload2Line } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { Modal } from "@/components/agents/sources/kit";
import { MapStep, ReviewStep } from "@/components/agents/sources/CsvSteps";
import { autoMap, CSV_MAX_BYTES, customKeyFor, MANDATORY_FIELDS, normalizeHeader, OPTIONAL_FIELDS, reviewRows } from "@/lib/csv-rows";

export interface ParsedCsv { name: string; text: string; headers: string[]; rows: Array<Record<string, string>> }

const STEPS = ["Upload", "Map", "Import"] as const;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-3 rounded-[14px] bg-base-100 px-6 py-4 shadow-[0_1px_2px_rgba(20,20,19,0.05)]" aria-label="Import steps">
      {STEPS.map((s, i) => {
        const n = i + 1, done = n < step, on = n === step;
        return (
          <li key={s} className={`flex items-center gap-3 ${i < STEPS.length - 1 ? "flex-1" : ""}`} aria-current={on ? "step" : undefined}>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-medium ${on ? "bg-neutral text-neutral-content" : done ? "bg-primary/15 text-primary" : "bg-base-200 text-base-content/50"}`}>{n}</span>
            <span className={`text-[15px] ${on ? "text-base-content" : done ? "text-primary" : "text-base-content/45"}`}>{s}</span>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${done ? "bg-primary/40" : "bg-[var(--border-subtle)]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Reads and checks the file in the browser; the server parses the same text again on import. */
export function parseFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return reject(new Error("Choose a .csv file"));
    if (file.size > CSV_MAX_BYTES) return reject(new Error("This file is larger than 10MB. Split it into smaller files."));
    file.text().then((text) => {
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const headers = (parsed.meta.fields ?? []).filter((h) => h.trim());
      if (!headers.length) return reject(new Error("The first line must be a header row with column names."));
      if (headers.some((h) => /linkedin\.com\/|@[\w-]+\./i.test(h))) return reject(new Error("The first line looks like a contact, not column names. Add a header row (e.g. first_name, last_name, linkedin_url)."));
      if (!parsed.data.length) return reject(new Error("This file has a header row but no contacts."));
      resolve({ name: file.name, text, headers, rows: parsed.data });
    }, () => reject(new Error("Could not read this file")));
  });
}

/** The import API's column mapping for the chosen fields plus the custom columns switched on. */
export function csvMapping(map: Record<string, string>, customOn: string[]) {
  return [
    ...[...MANDATORY_FIELDS, ...OPTIONAL_FIELDS].filter((f) => map[f.key]).map((f) => f.target.kind === "standard"
      ? { column: normalizeHeader(map[f.key]), kind: "standard", field: f.target.field }
      : { column: normalizeHeader(map[f.key]), kind: "custom", key: f.target.key, name: f.label, fieldType: "text" }),
    ...customOn.map((h) => ({ column: normalizeHeader(h), kind: "custom", key: customKeyFor(h), name: h, fieldType: "text" })),
  ];
}

/** "Import contacts from CSV": upload → map columns → review → import into "<agent> - CSV Import". */
export default function CsvImportModal({ agentId, agentName, autoEnrichEmails, onClose, onImported }: {
  agentId: string; agentName: string; autoEnrichEmails: boolean; onClose: () => void; onImported: () => void;
}) {
  const [step, setStep] = useState(1);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const used = new Set(Object.values(map).filter(Boolean));
  const unmapped = (csv?.headers ?? []).filter((h) => !used.has(h));
  const customOn = unmapped.filter((h) => custom[h]);
  const review = csv && step === 3 ? reviewRows(csv.rows, map, customOn) : [];
  const ready = review.filter((r) => r.status === "ready").length;
  const canReview = !!map.first_name && !!map.last_name && (!!map.linkedin_url || !!map.email);

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseFile(file);
      setCsv(parsed); setMap(autoMap(parsed.headers)); setCustom({}); setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this file"); }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); };

  function close() {
    if (importing) return;
    if (csv && !confirm("Discard this CSV import?")) return;
    onClose();
  }

  async function runImport() {
    if (!csv) return;
    setImporting(true);
    const mapping = csvMapping(map, customOn);
    try {
      const r = await fetch(`/api/agents/${agentId}/import-csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: csv.text, mapping }) });
      const d = await r.json().catch(() => ({ error: r.status === 413 ? "This CSV is too large. Split it into smaller files." : "Import failed" }));
      if (!r.ok) { toast.error(d.error ?? "Import failed"); return; }
      const parts = [`${d.imported} new contact${d.imported === 1 ? "" : "s"}`];
      if (d.duplicates) parts.push(`${d.duplicates} already in your workspace`);
      if (d.errors?.length) parts.push(`${d.errors.length} skipped`);
      toast.success(`Imported into "${d.list_name}": ${parts.join(", ")}`);
      onImported();
      onClose();
    } catch {
      toast.error("Import failed. Check your connection and try again.");
    } finally { setImporting(false); }
  }

  const footer = step === 1
    ? <button type="button" onClick={close} className="h-10 rounded-[8px] px-4 text-sm font-medium text-base-content/75 hover:bg-base-200">Cancel</button>
    : <>
        <button type="button" disabled={importing} onClick={() => setStep(step - 1)} className="inline-flex h-10 items-center gap-1 rounded-[8px] px-4 text-sm font-medium text-base-content/75 hover:bg-base-200"><RiArrowLeftSLine size={16} /> Back</button>
        {step === 2
          ? <button type="button" className={primaryBtn} disabled={!canReview} onClick={() => setStep(3)}>Continue to review</button>
          : <button type="button" className={primaryBtn} disabled={!ready || importing} onClick={runImport}>
              {importing ? <><RiLoader4Line size={16} className="animate-spin" /> Importing…</> : `Import ${ready} contact${ready === 1 ? "" : "s"}`}
            </button>}
      </>;

  return (
    <Modal labelId="csv-import-title" title="Import contacts from CSV" subtitle="Upload a CSV file, map your columns and add the contacts to this agent." onClose={close} footer={footer}>
      <div className="space-y-5 bg-base-200/40 px-4 py-6 sm:px-8">
        <Stepper step={step} />
        <div className="rounded-[16px] bg-base-100 px-5 py-7 sm:px-10">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-[22px] font-semibold text-base-content">Upload your CSV file</h3>
                <p className="mt-1 text-[15px] text-base-content/55">Drop or browse a CSV file with the contacts you want to import.</p>
              </div>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                className={`mx-auto flex max-w-[860px] flex-col items-center gap-3 rounded-[16px] border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? "border-primary/60 bg-primary/10" : "border-primary/20 bg-primary/5"}`}>
                <RiUploadCloud2Line size={44} className="text-base-content/45" aria-hidden="true" />
                <p className="text-[20px] font-medium text-base-content">Drop your CSV file here</p>
                <p className="text-[15px] text-base-content/55">or click to browse your computer</p>
                <button type="button" className={primaryBtn} onClick={() => input.current?.click()}><RiUpload2Line size={16} /> Choose CSV File</button>
                <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
                <p className="text-[13px] text-base-content/50">Supported format: CSV · Max size: 10MB</p>
                {error && <p role="alert" className="text-sm text-error">{error}</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[12px] border border-[var(--border-subtle)] p-5">
                  <h4 className="flex items-center gap-2 font-medium text-base-content"><RiCheckboxCircleLine size={18} className="text-success" /> Required CSV Columns</h4>
                  <ul className="mt-3 space-y-2 text-[15px] text-base-content/75">
                    {["First Name", "Last Name", "LinkedIn Profile URL or Email"].map((c) => <li key={c} className="flex items-center gap-2"><RiCheckLine size={16} className="text-primary" /> {c}</li>)}
                  </ul>
                </div>
                <div className="rounded-[12px] border border-[var(--border-subtle)] p-5">
                  <h4 className="flex items-center gap-2 font-medium text-base-content"><RiInformationLine size={18} className="text-primary" /> Format Guidelines</h4>
                  <ul className="mt-3 space-y-2 text-sm text-base-content/70">
                    <li className="flex gap-2"><RiCodeSSlashLine size={15} className="mt-0.5 shrink-0 text-primary" /> <span>Use commas to separate columns. The first line <b className="text-base-content">must be a header row</b> with column names (e.g. first_name, last_name, linkedin_url).</span></li>
                    <li className="flex gap-2"><RiLink size={15} className="mt-0.5 shrink-0 text-primary" /> LinkedIn URLs must look like https://linkedin.com/in/username</li>
                    <li className="flex gap-2"><RiAddLine size={15} className="mt-0.5 shrink-0 text-primary" /> Email, company, title and other columns are optional.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          {step === 2 && csv && <MapStep csv={csv} map={map} setMap={setMap} unmapped={unmapped} custom={custom} setCustom={setCustom} />}
          {step === 3 && csv && <ReviewStep rows={review} total={csv.rows.length} agentName={agentName} autoEnrichEmails={autoEnrichEmails} />}
        </div>
      </div>
    </Modal>
  );
}
