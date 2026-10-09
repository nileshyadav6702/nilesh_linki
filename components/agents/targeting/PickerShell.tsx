import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useDismiss } from "@/components/agents/leads/Listbox";

/**
 * Floating picker under a "+ Add" chip: search input on top, scrollable body, optional footer.
 * Escape or an outside click closes it; Escape does not reach the drawer. ArrowUp/ArrowDown
 * move between the body's `[data-row]` buttons.
 */
export default function PickerShell({ label, query, onQuery, onEnter, placeholder, onClose, header, footer, children }: {
  label: string; query: string; onQuery: (q: string) => void; onEnter: () => void; placeholder: string; onClose: () => void;
  header?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useDismiss(true, [wrap], onClose);
  useEffect(() => { input.current?.focus(); }, []);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(body.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") rows[Math.min(rows.length - 1, at + 1)]?.focus();
    else if (at <= 0) input.current?.focus();
    else rows[at - 1]?.focus();
  }

  return (
    <div ref={wrap} role="dialog" aria-label={label} onKeyDown={onKey}
      className="absolute left-0 top-full z-30 mt-2 flex max-h-[420px] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
      <div className="border-b border-[var(--border-subtle)] p-2">
        <input ref={input} value={query} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
          className="h-11 w-full rounded-[10px] border border-primary/40 bg-base-100 px-3 text-[15px] text-base-content outline-none ring-2 ring-primary/10 focus:border-primary/60" />
      </div>
      {header}
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
      {footer && <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-[14.5px] text-base-content/55">{footer}</div>}
    </div>
  );
}
