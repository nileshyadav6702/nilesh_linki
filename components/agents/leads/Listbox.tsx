import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { RiArrowDownSLine, RiCheckLine } from "react-icons/ri";

/** Close a floating element on an outside mousedown or Escape. */
export function useDismiss(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close.current();
    };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
    // refs are stable objects from useRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export interface ListboxOption { value: string; label: string; count?: number }

/**
 * Custom select: a field-styled button and a floating list with right-aligned counts and a coral
 * check on the selected option. Arrow keys move, Enter/Space pick, Escape closes.
 */
export default function Listbox({ value, options, onChange, label, className = "", placeholder }: {
  value: string; options: ListboxOption[]; onChange: (v: string) => void; label: string; className?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useDismiss(open, [wrap], () => setOpen(false));
  const current = options.find((o) => o.value === value);

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
    requestAnimationFrame(() => list.current?.focus());
  }
  function pick(v: string) {
    onChange(v);
    setOpen(false);
    button.current?.focus();
  }
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onListKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (options[active]) pick(options[active].value); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? placeholder ?? ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); show(); } }}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-[8px] border bg-base-100 px-3 text-left text-[15px] text-base-content outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${open ? "border-[var(--border-focus)]" : "border-[var(--border-subtle)] hover:bg-base-200/60"}`}>
        <span className="truncate">{current?.label ?? placeholder ?? "Select"}</span>
        <RiArrowDownSLine size={18} className={`shrink-0 text-base-content/45 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul ref={list} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 min-w-[200px] overflow-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 text-[15px] shadow-[var(--shadow-overlay)] outline-none">
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <li key={o.value || "_"} id={`${id}-${i}`} data-index={i} role="option" aria-selected={on}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 ${on ? "bg-primary/10 text-primary" : i === active ? "bg-base-200 text-base-content" : "text-base-content/80"}`}>
                <span className="truncate">{o.label}</span>
                {on ? <RiCheckLine size={16} className="shrink-0" aria-hidden="true" /> : o.count !== undefined && <span className="shrink-0 text-[14.5px] tabular-nums text-base-content/45">{o.count}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
