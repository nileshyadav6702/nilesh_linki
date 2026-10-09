import { useState } from "react";
import { RiCheckLine, RiCloseLine, RiLoader4Line, RiEditBoxLine } from "react-icons/ri";

/** Inline editing for the lead drawer header: a pencil button, then side-by-side inputs with ✓ / ✕. */

export interface EditField { key: string; label: string; value: string; placeholder?: string; type?: "text" | "email" | "tel" }

export function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-base-content/45 transition-colors hover:bg-base-200 hover:text-base-content">
      <RiEditBoxLine size={19} />
    </button>
  );
}

export function InlineEdit({ fields, onSave, onCancel }: { fields: EditField[]; onSave: (values: Record<string, string>) => Promise<boolean>; onCancel: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [busy, setBusy] = useState(false);
  const changed = fields.some((f) => (values[f.key] ?? "").trim() !== f.value.trim());
  async function save() {
    if (!changed) { onCancel(); return; }
    setBusy(true);
    const ok = await onSave(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? "").trim()])));
    setBusy(false);
    if (ok) onCancel();
  }
  return (
    <form className="wizard-rise flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      {fields.map((f, i) => (
        <input key={f.key} autoFocus={i === 0} type={f.type ?? "text"} aria-label={f.label} placeholder={f.placeholder ?? f.label}
          value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3 text-[14px] text-base-content outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
      ))}
      <button type="submit" disabled={busy} aria-label="Save" title="Save (Enter)"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-content shadow-[0_4px_10px_-4px_var(--color-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-70">
        {busy ? <RiLoader4Line size={17} className="animate-spin" /> : <RiCheckLine size={18} />}
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel" title="Cancel (Esc)"
        className="flex h-9 w-7 shrink-0 items-center justify-center rounded-[8px] text-base-content/60 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={18} /></button>
    </form>
  );
}
