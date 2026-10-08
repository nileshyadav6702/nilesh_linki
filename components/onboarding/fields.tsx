import { useState } from "react";
import { RiAddLine, RiCloseLine } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import { inputCls } from "@/components/agents/ui";

export const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Dutch", "Italian", "Hindi"];
export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];
export const COMPANY_TYPES = ["Startup", "SMB", "Mid-market", "Enterprise"];
export const PEOPLE_EXCLUDES = ["Service providers, freelancers, consultants", "Open to work"];

export const filled = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);

export function buyerTitles(icp: Icp): string[] {
  return [...new Set(icp.personas.flatMap((p) => p.titles.map((t) => t.trim()).filter(Boolean)))];
}

export function withTitles(icp: Icp, titles: string[]): Icp {
  const base = icp.personas[0] ?? { name: "Buyers", titles: [], seniority: [], departments: [], pains: [] };
  return { ...icp, personas: [{ ...base, name: base.name || "Buyers", titles }, ...icp.personas.slice(1).map((p) => ({ ...p, titles: [] }))] };
}

export function StepHead({ kicker, title, text }: { kicker?: string; title: string; text: string }) {
  return (
    <div className="mb-6 text-center">
      {kicker && <p className="mb-2 text-[13px] font-medium text-primary">{kicker}</p>}
      <h2 className="text-[28px] leading-[1.15]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-base-content/55">{text}</p>
    </div>
  );
}

export function Choice({ selected, title, text, onClick }: { selected: boolean; title: string; text?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[12px] border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-[var(--border-subtle)] bg-base-100 hover:border-[var(--border-strong)]"}`}>
      <div className="text-sm font-medium text-base-content">{title}</div>
      {text && <p className="mt-1 text-xs leading-5 text-base-content/55">{text}</p>}
    </button>
  );
}

export function Pills({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button key={option} type="button" onClick={() => onChange(on ? selected.filter((x) => x !== option) : [...selected, option])} className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 text-base-content" : "border-[var(--border-subtle)] bg-base-100 text-base-content/70"}`}>
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function CheckRow({ checked, label, hint, onChange }: { checked: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-3 ${checked ? "border-primary bg-primary/10" : "border-[var(--border-subtle)] bg-base-100"}`}>
      <input type="checkbox" className="checkbox checkbox-sm checkbox-primary mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm text-base-content">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-base-content/50">{hint}</span>}
      </span>
    </label>
  );
}

/** One field per item, stacked. Empty rows are kept while editing and dropped by the caller on save. */
export function StackedList({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const rows = values.length ? values : [""];
  const write = (next: string[]) => onChange(next.length ? next : [""]);
  return (
    <div className="space-y-2">
      {rows.map((value, index) => (
        <div key={index} className="flex gap-2">
          <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => write(rows.map((row, i) => i === index ? e.target.value : row))} />
          {rows.length > 1 && (
            <button type="button" aria-label="Remove" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] text-base-content/45 hover:text-error" onClick={() => write(rows.filter((_, i) => i !== index))}>
              <RiCloseLine size={16} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-primary" onClick={() => write([...rows, ""])}>
        <RiAddLine size={16} /> Add another
      </button>
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
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-base-content">
              <span className="truncate">{value}</span>
              <button type="button" aria-label={`Remove ${value}`} className="text-base-content/45 hover:text-error" onClick={() => onChange(values.filter((v) => v !== value))}><RiCloseLine size={12} /></button>
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
