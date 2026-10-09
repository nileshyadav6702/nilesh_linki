import { useId, useState, type ReactNode } from "react";
import { RiAddLine, RiCheckLine, RiCloseLine } from "react-icons/ri";

export interface ChipItem { value: string; label: string }

/** Selected value: coral tint with a remove ×. */
export function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-primary/25 bg-primary/10 py-1 pl-3 pr-1.5 text-[15px] text-primary">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-primary/70 hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <RiCloseLine size={14} />
      </button>
    </span>
  );
}

/** Preset that toggles in place: coral with × when on, neutral when off. */
export function ToggleChip({ label, on, onToggle, check = false, row = false }: { label: string; on: boolean; onToggle: () => void; check?: boolean; row?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} data-row={row ? "" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary/25 bg-primary/10 text-primary" : "border-[var(--border-subtle)] bg-base-100 text-base-content/75 hover:bg-base-200"}`}>
      {on && check && <RiCheckLine size={14} aria-hidden="true" />}
      {label}
      {on && !check && <RiCloseLine size={14} aria-hidden="true" className="text-primary/70" />}
    </button>
  );
}

/**
 * Selected chips plus a dashed "+ Add" chip that opens a picker below it. The picker gets a
 * `close` callback; focus returns to the Add chip when it closes.
 */
export function ChipField({ items, onRemove, picker, addLabel = "Add" }: { items: ChipItem[]; onRemove: (value: string) => void; picker: (close: () => void) => ReactNode; addLabel?: string }) {
  const [open, setOpen] = useState(false);
  const addId = useId();
  const close = () => { setOpen(false); document.getElementById(addId)?.focus(); };
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {items.map((it) => <Chip key={it.value} label={it.label} onRemove={() => onRemove(it.value)} />)}
      <button id={addId} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        // While open, keep this mousedown from reaching the picker's outside-click handler so a click toggles it closed.
        onMouseDown={(e) => { if (open) e.stopPropagation(); }}
        className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-base-content/40 px-3 py-1 text-[15px] font-medium text-base-content/75 hover:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <RiAddLine size={14} /> {addLabel}
      </button>
      {open && picker(close)}
    </div>
  );
}

/** Text input + coral Add button that appends trimmed, de-duplicated entries (comma separated allowed). */
export function AddInput({ values, onChange, placeholder, label }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [text, setText] = useState("");
  function add() {
    const fresh = text.split(",").map((x) => x.trim()).filter((x) => x && !values.some((v) => v.toLowerCase() === x.toLowerCase()));
    if (fresh.length) onChange([...values, ...new Set(fresh)]);
    setText("");
  }
  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => <Chip key={v} label={v} onRemove={() => onChange(values.filter((x) => x !== v))} />)}
        </div>
      )}
      <div className="flex gap-2">
        <input className="h-10 min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15px] text-base-content outline-none transition focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]"
          value={text} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} disabled={!text.trim()}
          className="inline-flex h-10 shrink-0 items-center rounded-[8px] bg-primary px-5 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-[#e6dfd8] disabled:text-[#8e8b82]">
          Add
        </button>
      </div>
    </div>
  );
}
