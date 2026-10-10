import { useRef, useState } from "react";
import { format } from "date-fns";
import { RiCalendarLine, RiCloseLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { DateCalendar, fromDay } from "@/components/ui/DateRangePicker";

/**
 * Date input: a field-styled button that opens the shared calendar. Value is "YYYY-MM-DD" or "".
 * With `name` it also posts the value in a plain <form> through a hidden input.
 */
export default function DateField({ value, onChange, min, max, name, placeholder = "Pick a date", clearable = true, className = "", label }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; name?: string;
  placeholder?: string; clearable?: boolean; className?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const d = fromDay(value);
  return (
    <div ref={wrap} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={label ? `${label}: ${d ? format(d, "PPP") : "not set"}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-10 w-full items-center gap-2 rounded-[8px] border bg-base-100 pl-3 pr-2 text-left text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${open ? "border-[var(--border-focus)]" : "border-[var(--border-strong)] hover:bg-base-200/50"}`}>
        <RiCalendarLine size={15} className="shrink-0 text-base-content/45" />
        <span className={`min-w-0 flex-1 truncate ${d ? "text-base-content" : "text-base-content/45"}`}>{d ? format(d, "MMM d, yyyy") : placeholder}</span>
        {clearable && d && (
          <span role="button" tabIndex={0} aria-label="Clear date" onClick={(e) => { e.stopPropagation(); onChange(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-base-content/45 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={15} /></span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label={label ?? "Pick a date"} className="pop-in absolute left-0 top-full z-50 mt-1.5 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
          <DateCalendar value={value || null} min={min} max={max} onChange={(v) => { onChange(v ?? ""); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
