import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { LuArrowLeft, LuBuilding2, LuCloudUpload, LuDownload, LuFileText, LuLoaderCircle, LuPencil, LuPlus, LuUser, LuX } from "react-icons/lu";
import { SideDrawer } from "@/components/agents/campaign/kit";
import Listbox from "@/components/agents/leads/Listbox";

/** "Add to blocklist": companies (domain + optional name) or people (LinkedIn URL), typed or from a CSV. */

export type BlockKind = "company" | "person";
type Step = "choose" | "manual" | "csv" | "confirm";
interface Row { value: string; label: string }

const MAX_FILE = 5 * 1024 * 1024;
const NONE = "__none";
const label = "text-[14px] font-medium tracking-[0.08em] text-base-content/55 [text-transform:uppercase]";
const input = "h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";

export function KindSwitch({ kind, onChange, counts }: { kind: BlockKind; onChange: (k: BlockKind) => void; counts?: Record<BlockKind, number> }) {
  const item = (k: BlockKind, icon: React.ReactNode, text: string) => (
    <button type="button" onClick={() => onChange(k)} aria-pressed={kind === k}
      className={`inline-flex h-12 flex-1 items-center justify-center gap-2.5 rounded-[10px] px-5 text-[17px] transition-colors ${kind === k ? "bg-base-100 font-medium shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-base-content/65 hover:text-base-content"}`}>
      {icon}{text}{counts && <span className="text-[15px] text-base-content/50">({counts[k]})</span>}
    </button>
  );
  return (
    <div className="inline-flex w-full gap-1 rounded-[12px] border border-[var(--border-subtle)] bg-base-200/60 p-1">
      {item("company", <LuBuilding2 size={20} />, "Companies")}{item("person", <LuUser size={20} />, "People")}
    </div>
  );
}

function exampleCsv(kind: BlockKind) {
  const text = kind === "company" ? "website_domain,company_name\nacme.com,Acme Inc\ncompetitor.io,Competitor Co\nexample.fr,Example SAS\n"
    : "linkedin_url\nhttps://www.linkedin.com/in/jane-doe\nhttps://www.linkedin.com/in/john-smith\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = `blocklist-${kind === "company" ? "companies" : "people"}-example.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AddBlockDrawer({ initialKind, onClose, onAdded }: { initialKind: BlockKind; onClose: () => void; onAdded: (kind: BlockKind) => void }) {
  const [kind, setKind] = useState<BlockKind>(initialKind);
  const [step, setStep] = useState<Step>("choose");
  const [rows, setRows] = useState<Row[]>([{ value: "", label: "" }]);
  const [file, setFile] = useState<{ name: string; data: string[][] } | null>(null);
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<{ value: string; label: string }>({ value: NONE, label: NONE });
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const columns = useMemo(() => {
    if (!file?.data.length) return [];
    const width = Math.max(...file.data.slice(0, 50).map((r) => r.length));
    return Array.from({ length: width }, (_, i) => (header ? file.data[0][i]?.trim() : "") || `Column ${i + 1}`);
  }, [file, header]);
  const body = file ? (header ? file.data.slice(1) : file.data) : [];

  const entries = step === "manual"
    ? rows.filter((r) => r.value.trim()).map((r) => ({ value: r.value.trim(), label: r.label.trim() || null }))
    : step === "confirm" && map.value !== NONE
      ? body.map((r) => ({ value: (r[Number(map.value)] ?? "").trim(), label: map.label !== NONE ? (r[Number(map.label)] ?? "").trim() || null : null })).filter((e) => e.value)
      : [];

  function readFile(f: File) {
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") { toast.error("Choose a .csv file"); return; }
    if (f.size > MAX_FILE) { toast.error("That file is over 5 MB"); return; }
    Papa.parse<string[]>(f, {
      skipEmptyLines: true,
      complete: (r) => {
        const data = r.data.filter((row) => row.some((c) => c?.trim()));
        if (!data.length) { toast.error("That file has no rows"); return; }
        setFile({ name: f.name, data });
        // Guess the columns from the header names.
        const heads = data[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
        // First header that matches, in order of preference.
        const find = (...res: RegExp[]) => { for (const re of res) { const i = heads.findIndex((h) => re.test(h)); if (i >= 0) return String(i); } return NONE; };
        setMap(kind === "company"
          ? { value: find(/^website_domain$/, /^(company_)?domain$/, /^(company_)?website$/, /domain/, /website/), label: find(/^company_name$/, /^company$/, /^(organization|account)(_name)?$/, /company/) }
          : { value: find(/^linkedin_url$/, /linkedin/, /profile/), label: NONE });
        setStep("confirm");
      },
      error: () => toast.error("Could not read that file"),
    });
  }

  async function submit() {
    if (!entries.length || busy) return;
    setBusy(true);
    const r = await fetch("/api/settings/blocklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, entries, source: step === "confirm" ? "csv" : "manual" }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast.error(d.error ?? "Could not add to the blocklist"); return; }
    const skipped = d.invalid?.length ? ` · ${d.invalid.length} skipped (not a valid ${kind === "company" ? "domain" : "LinkedIn profile URL"})` : "";
    toast.success(`${d.added} added${d.existing ? `, ${d.existing} already blocked` : ""}${skipped}`);
    onAdded(kind);
  }

  const back = step === "choose" ? undefined : () => setStep(step === "confirm" ? "csv" : "choose");
  const title = { choose: "Add to blocklist", manual: "Add manually", csv: "Import a CSV file", confirm: "Confirm import" }[step];
  const option = (icon: React.ReactNode, head: string, sub: string, go: Step) => (
    <button type="button" onClick={() => setStep(go)} className="flex w-full items-start gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-5 py-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">{icon}</span>
      <span><span className="block text-[18px] font-medium">{head}</span><span className="mt-0.5 block text-[15px] text-base-content/65">{sub}</span></span>
    </button>
  );

  return (
    <SideDrawer width={860} onClose={onClose}
      title={<span className="flex items-center gap-3">{back && <button type="button" onClick={back} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-[8px] hover:bg-base-200"><LuArrowLeft size={20} /></button>}{title}</span>}
      footer={<>
        <button type="button" onClick={onClose} className="h-11 rounded-[8px] px-4 text-[16px] font-medium hover:bg-base-200">Cancel</button>
        {(step === "manual" || step === "confirm") && (
          <button type="button" disabled={!entries.length || busy} onClick={() => void submit()} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-50">
            {busy && <LuLoaderCircle size={17} className="animate-spin" />}Block {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </button>
        )}
      </>}>
      <div className="space-y-6 pb-4">
        {step === "choose" && <>
          <div><div className={label}>Category</div><div className="mt-2"><KindSwitch kind={kind} onChange={setKind} /></div></div>
          <div className="text-[17px] text-base-content/75">How would you like to add entries to your blocklist?</div>
          <div className="space-y-3">
            {option(<LuPencil size={22} />, kind === "company" ? "Add blocked companies & domains manually" : "Add blocked people manually",
              kind === "company" ? "Type domains (required) and optional company names. Best for small lists." : "Type LinkedIn profile URLs. Best for small lists.", "manual")}
            {option(<LuFileText size={22} />, "Import a CSV file",
              kind === "company" ? "Upload a CSV with website_domain (required) and optional company_name." : "Upload a CSV with a linkedin_url column.", "csv")}
          </div>
        </>}

        {step === "manual" && <>
          <div className="text-[17px] text-base-content/75">{kind === "company" ? "Fill in website domains and, optionally, company names." : "Fill in LinkedIn profile URLs."}</div>
          <div className="space-y-3 rounded-[12px] border border-[var(--border-subtle)] p-5">
            <div className={`grid gap-3 ${kind === "company" ? "grid-cols-[1fr_1fr_40px]" : "grid-cols-[1fr_40px]"}`}>
              <div className={label}>{kind === "company" ? "Website domain" : "LinkedIn profile URL"} <span className="text-error">*</span></div>
              {kind === "company" && <div className={label}>Company name</div>}
              <span />
              {rows.map((r, i) => (
                <div key={i} className="contents">
                  <input autoFocus={i === rows.length - 1} value={r.value} placeholder={kind === "company" ? "acme.com" : "https://www.linkedin.com/in/jane-doe"} aria-label={kind === "company" ? "Website domain" : "LinkedIn profile URL"}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    onKeyDown={(e) => { if (e.key === "Enter" && r.value.trim()) setRows([...rows, { value: "", label: "" }]); }} className={input} />
                  {kind === "company" && <input value={r.label} placeholder="Acme Inc" aria-label="Company name" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={input} />}
                  <button type="button" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="flex h-12 w-10 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 disabled:opacity-30"><LuX size={18} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setRows([...rows, { value: "", label: "" }])} className="inline-flex h-10 items-center gap-2 rounded-[8px] px-2 text-[16px] font-medium text-primary hover:bg-primary/5"><LuPlus size={18} />Add another</button>
          </div>
          <div className="text-[15px] text-base-content/60">{entries.length} {entries.length === 1 ? "entry" : "entries"} ready to block. Paste one per row; press Enter for a new row.</div>
        </>}

        {step === "csv" && <>
          <div className="text-[17px] leading-relaxed text-base-content/75">
            {kind === "company" ? <>Upload a CSV with a <b>website_domain</b> column (required). You can also include an optional <b>company_name</b> column.</> : <>Upload a CSV with a <b>linkedin_url</b> column.</>}
          </div>
          <button type="button" onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
            className={`flex w-full flex-col items-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-12 transition-colors ${drag ? "border-primary bg-primary/5" : "border-[var(--border-strong)] hover:bg-base-200/40"}`}>
            <LuCloudUpload size={44} className="text-base-content/55" />
            <span className="text-[18px] font-medium">Click to upload a CSV file</span>
            <span className="text-[15px] text-base-content/60">or drag and drop here (up to 5 MB)</span>
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
          <div>
            <div className="flex items-center justify-between"><div className={label}>What should my CSV look like?</div>
              <button type="button" onClick={() => exampleCsv(kind)} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-primary hover:underline"><LuDownload size={16} />Example</button></div>
            <div className="mt-3 overflow-hidden rounded-[12px] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 text-[16px] font-medium">{kind === "company" ? <LuBuilding2 size={18} /> : <LuUser size={18} />}Block {kind === "company" ? "companies" : "people"}</div>
              <table className="w-full font-mono text-[14px]">
                <thead><tr className="text-left text-base-content/60"><th className="px-4 py-2 font-medium">{kind === "company" ? "website_domain" : "linkedin_url"} <span className="text-error">*</span></th>{kind === "company" && <th className="px-4 py-2 font-medium">company_name</th>}</tr></thead>
                <tbody>
                  {(kind === "company" ? [["acme.com", "Acme Inc"], ["competitor.io", "Competitor Co"], ["example.fr", "Example SAS"]] : [["https://www.linkedin.com/in/jane-doe"], ["https://www.linkedin.com/in/john-smith"]]).map((r) => (
                    <tr key={r[0]} className="border-t border-[var(--border-subtle)]">{r.map((c) => <td key={c} className="px-4 py-2">{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>}

        {step === "confirm" && file && <>
          <div className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-[16px]"><LuFileText size={18} className="shrink-0 text-primary" /><span className="truncate">{file.name}</span></span>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[16px]"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="checkbox checkbox-sm checkbox-primary" />First row is a header</label>
          </div>
          <div>
            <div className="text-[16px] font-medium">Preview</div>
            <div className="mt-2 overflow-x-auto rounded-[12px] border border-[var(--border-subtle)]">
              <table className="w-full min-w-max text-[14px]">
                <thead><tr className="text-left">{columns.map((c, i) => <th key={i} className="whitespace-nowrap px-4 py-2.5 font-medium text-base-content/70">{c}</th>)}</tr></thead>
                <tbody>{body.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-[var(--border-subtle)]">{columns.map((_, j) => <td key={j} className="max-w-[260px] truncate whitespace-nowrap px-4 py-2">{r[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="mt-2 text-[15px] text-base-content/60">{body.length} {body.length === 1 ? "row" : "rows"} found</div>
          </div>
          <div className="grid max-w-[480px] gap-5">
            <div>
              <div className="mb-2 text-[16px] font-medium">{kind === "company" ? "Website domain" : "LinkedIn profile URL"} <span className="text-error">*</span></div>
              <Listbox label={kind === "company" ? "Website domain column" : "LinkedIn URL column"} value={map.value} onChange={(v) => setMap({ ...map, value: v })}
                options={[{ value: NONE, label: "— Not mapped —" }, ...columns.map((c, i) => ({ value: String(i), label: `${c} (col ${i + 1})` }))]} className="[&>button]:h-12 [&>button]:text-[16px]" />
            </div>
            {kind === "company" && (
              <div>
                <div className="mb-2 text-[16px] font-medium">Company name</div>
                <Listbox label="Company name column" value={map.label} onChange={(v) => setMap({ ...map, label: v })}
                  options={[{ value: NONE, label: "— Not mapped —" }, ...columns.map((c, i) => ({ value: String(i), label: `${c} (col ${i + 1})` }))]} className="[&>button]:h-12 [&>button]:text-[16px]" />
              </div>
            )}
          </div>
        </>}
      </div>
    </SideDrawer>
  );
}
