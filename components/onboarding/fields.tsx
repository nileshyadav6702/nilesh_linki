import { useState, type ReactNode } from "react";
import { RiAddLine, RiCheckLine, RiCloseLine, RiDeleteBinLine, RiInformationLine } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import { inputCls } from "@/components/agents/ui";

export const LANGUAGES = ["English (US)", "English (UK)", "Spanish", "French", "German", "Portuguese", "Dutch", "Italian", "Hindi"];
export const INDUSTRIES = ["Software Development & SaaS", "IT Services and IT Consulting", "E-Learning Providers", "Education", "Professional Training & Coaching", "Marketing", "Staffing and Recruiting", "Financial Services", "Healthcare", "Manufacturing", "Retail", "Real Estate"];
export const COMPANY_SIZES = ["1-10 employees", "11-50 employees", "51-200 employees", "201-500 employees", "501-1000 employees", "1001-5000 employees", "5001-10000 employees", "10000+ employees"];
export const COMPANY_TYPES = ["Private Company", "Public Company", "Startup", "Non-profit", "Government", "Educational Institution"];
export const PEOPLE_EXCLUDES = ["Service providers, freelancers, consultants", "Open to work"];

const SIZE_ALIASES: Record<string, string> = {
  "1-10": "1-10 employees", "11-50": "11-50 employees", "51-200": "51-200 employees", "201-500": "201-500 employees",
  "501-1000": "501-1000 employees", "1001-5000": "1001-5000 employees", "5000+": "10000+ employees", "5001-10000": "5001-10000 employees",
};
const TYPE_ALIASES: Record<string, string> = { SMB: "Private Company", "Mid-market": "Private Company", Enterprise: "Public Company" };

export const filled = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);

export function normalizeLanguage(value: string): string {
  const text = value.trim();
  if (!text || /^english$/i.test(text)) return "English (US)";
  return text;
}

export function normalizeDraft(icp: Icp): Icp {
  return {
    ...icp,
    language: normalizeLanguage(icp.language),
    company_sizes: [...new Set(icp.company_sizes.map((size) => SIZE_ALIASES[size] ?? size))].slice(0, 10),
    company_types: [...new Set(icp.company_types.map((type) => TYPE_ALIASES[type] ?? type))].slice(0, 12),
  };
}

export function buyerTitles(icp: Icp): string[] {
  return [...new Set(icp.personas.flatMap((p) => p.titles.map((t) => t.trim()).filter(Boolean)))];
}

export function withTitles(icp: Icp, titles: string[]): Icp {
  const base = icp.personas[0] ?? { name: "Buyers", titles: [], seniority: [], departments: [], pains: [] };
  return { ...icp, personas: [{ ...base, name: base.name || "Buyers", titles }, ...icp.personas.slice(1).map((p) => ({ ...p, titles: [] }))] };
}

export function Title({ title, text }: { title: string; text?: string }) {
  return (
    <div className="mb-6 text-center">
      <h2 className="text-[26px] leading-[1.2]">{title}</h2>
      {text && <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-base-content/55">{text}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-base-content/45">{children}</p>;
}

const chipCls = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "border-[var(--border-subtle)] bg-base-100 text-base-content/80"}`;

/** Empty selection means the "All …" chip is on. Picking a specific value clears that. */
export function ChipSelect({ allLabel, options, selected, onChange, allowAdd, addLabel = "Add" }: { allLabel: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; allowAdd?: boolean; addLabel?: string }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const all = selected.length === 0;
  const choices = [...new Set([...options, ...selected])];
  const add = () => {
    const value = text.trim();
    if (value && !selected.includes(value)) onChange([...(all ? [] : selected), value]);
    setText("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chipCls(all)} onClick={() => onChange([])}>{allLabel}</button>
      {choices.map((option) => {
        const on = !all && selected.includes(option);
        return (
          <button key={option} type="button" className={chipCls(on)} onClick={() => onChange(on ? selected.filter((item) => item !== option) : [...(all ? [] : selected), option])}>
            {option}{on && <RiCheckLine size={14} />}
          </button>
        );
      })}
      {allowAdd && (adding ? (
        <input autoFocus className="h-9 w-44 rounded-full border border-primary bg-base-100 px-3 text-sm outline-none" value={text} placeholder={addLabel} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      ) : (
        <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-subtle)] px-3 py-1.5 text-sm text-base-content/60" onClick={() => setAdding(true)}><RiAddLine size={14} /> Add</button>
      ))}
    </div>
  );
}

export function RoleChips({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setText("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {values.map((value) => (
        <button key={value} type="button" className={chipCls(true)} onClick={() => onChange(values.filter((item) => item !== value))}>
          {value} <RiCheckLine size={14} />
        </button>
      ))}
      {adding ? (
        <input autoFocus className="h-9 w-48 rounded-full border border-primary bg-base-100 px-3 text-sm outline-none" value={text} placeholder="Job title" onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      ) : (
        <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-subtle)] px-3 py-1.5 text-sm text-base-content/60" onClick={() => setAdding(true)}><RiAddLine size={14} /> Add</button>
      )}
    </div>
  );
}

export function CheckRow({ checked, label, hint, onChange }: { checked: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-[12px] border bg-base-100 px-4 py-3 ${checked ? "border-primary" : "border-[var(--border-subtle)]"}`}>
      <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1 text-sm text-base-content">{label}</span>
      {hint && <span title={hint} className="text-base-content/30"><RiInformationLine size={16} /></span>}
    </label>
  );
}

export function RadioCard({ selected, title, text, onClick, mark }: { selected: boolean; title: string; text?: string; onClick: () => void; mark?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-start gap-3 rounded-[12px] border bg-base-100 px-4 py-3 text-left ${selected ? "border-primary" : "border-[var(--border-subtle)]"}`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary" : "border-[var(--border-strong)]"}`}>{selected && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-base-content">{mark}{title}</span>
        {text && <span className="mt-0.5 block text-xs leading-5 text-base-content/55">{text}</span>}
      </span>
    </button>
  );
}

/** Filled rows, each with a remove control, then a blank row whose Add button commits it. */
export function EntryList({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const rows = values.filter((value) => value.trim());
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...rows, value]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <input className={inputCls} value={value} onChange={(e) => onChange(values.map((row, i) => i === index ? e.target.value : row))} />
          <button type="button" aria-label="Remove" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] text-base-content/35 hover:text-error" onClick={() => onChange(values.filter((_, i) => i !== index))}><RiDeleteBinLine size={15} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <input className={inputCls} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="inline-flex h-10 items-center rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-sm text-base-content/70 disabled:opacity-40" disabled={!draft.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}

export function ChipAdd({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim();
    if (!value || values.includes(value)) { setText(""); return; }
    onChange([...values, value]);
    setText("");
  };
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
              <span className="truncate">{value}</span>
              <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((v) => v !== value))}><RiCloseLine size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input className={inputCls} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="inline-flex h-10 items-center rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-sm" onClick={add}>Add</button>
      </div>
    </div>
  );
}
