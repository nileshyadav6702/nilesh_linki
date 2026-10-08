import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { RiArrowDownSLine, RiCheckLine, RiCloseLine, RiSearchLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";

/** Small building blocks for the Lead sources drawer and its import modals. */

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Dialog behaviour shared by the drawer and the modals (same as TargetingDrawer): animate in,
 * lock page scroll, focus the panel, trap Tab, Escape requests close, focus returns to the opener.
 */
export function useDialog(panel: RefObject<HTMLDivElement | null>, requestClose: () => void) {
  const [shown, setShown] = useState(false);
  const close = useRef(requestClose);
  useEffect(() => { close.current = requestClose; });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setShown(true));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [panel]);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return { shown, onKeyDown };
}

/** Centered modal (CSV / LinkedIn import) stacked above the drawer. */
export function Modal({ title, subtitle, onClose, children, footer, labelId, wide = true }: {
  title: string; subtitle: string; onClose: () => void; children: ReactNode; footer?: ReactNode; labelId: string; wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { shown, onKeyDown } = useDialog(panel, onClose);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose}
        className={`absolute inset-0 bg-[#141413]/40 transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1} onKeyDown={onKeyDown}
        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[16px] bg-base-100 shadow-[var(--shadow-overlay)] outline-none transition duration-200 motion-reduce:transition-none ${wide ? "max-w-[1240px]" : "max-w-[720px]"} ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="min-w-0">
            <h2 id={labelId} className="text-[20px] font-medium leading-tight text-base-content">{title}</h2>
            <p className="mt-1 text-sm text-base-content/55">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content">
            <RiCloseLine size={20} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function SoonPill() {
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-base-200 px-2 py-0.5 text-[12px] font-medium text-base-content/50">Coming soon</span>;
}

export function NewPill() {
  return <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#3a8c4f]">New</span>;
}

/** Panel title row: "Competitor engagement [1 tracked]" + description. */
export function PanelHeader({ title, count, description }: { title: string; count?: number; description: string }) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[19px] font-medium text-base-content">
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[13px] font-normal text-primary">{count} tracked</span>}
      </h3>
      <p className="text-[15px] text-base-content/55">{description}</p>
    </div>
  );
}

export const SubHeading = ({ children }: { children: ReactNode }) => <h4 className="text-[15px] font-medium text-base-content">{children}</h4>;

/** Square coral checkbox row with title, optional pill and hint. Disabled rows show Coming soon. */
export function CheckRow({ label, hint, checked, onChange, disabled, pill, soon }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; pill?: ReactNode; soon?: boolean;
}) {
  const off = disabled || soon;
  return (
    <label className={`flex items-start gap-3 border-b border-[var(--border-subtle)] px-1 py-3.5 last:border-0 ${off ? "cursor-not-allowed" : "cursor-pointer hover:bg-base-200/40"}`}>
      <input type="checkbox" checked={checked && !soon} disabled={off} onChange={(e) => onChange(e.target.checked)}
        className="checkbox checkbox-sm checkbox-primary mt-0.5 rounded-[5px]" />
      <span className={`min-w-0 flex-1 ${off ? "opacity-55" : ""}`}>
        <span className="flex flex-wrap items-center gap-2 text-[15px] text-base-content">{label}{pill}</span>
        <span className="block text-[13px] text-base-content/55">{hint}</span>
      </span>
      {soon && <SoonPill />}
    </label>
  );
}

/** Initial on a tinted tile, for companies / people without a logo. */
export function InitialTile({ label, size = 40 }: { label: string; size?: number }) {
  const hue = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span style={{ width: size, height: size, background: `hsl(${hue} 60% 92%)`, color: `hsl(${hue} 45% 32%)` }}
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] text-[15px] font-semibold uppercase">{label.trim().charAt(0) || "?"}</span>
  );
}

/** A tracked item row with a remove ✕. */
export function TrackedRow({ lead, title, sub, onRemove }: { lead?: ReactNode; title: string; sub?: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-3 last:border-0">
      {lead}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] text-base-content">{title}</div>
        {sub && <div className="truncate text-[13px] text-base-content/50">{sub}</div>}
      </div>
      <button type="button" onClick={onRemove} aria-label={`Remove ${title}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-base-content/45 hover:bg-base-200 hover:text-error"><RiCloseLine size={18} /></button>
    </div>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean; note?: string; lead?: ReactNode; pill?: ReactNode }

/**
 * Searchable select: a field button opens a floating list with a search box. Disabled options
 * are struck through and not selectable ("(already used)").
 */
export function SearchSelect({ value, options, onChange, placeholder, label, searchable = true, invalid }: {
  value: string; options: SelectOption[]; onChange: (v: string) => void; placeholder: string; label: string; searchable?: boolean; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const current = options.find((o) => o.value === value);
  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (o: SelectOption) => { if (o.disabled) return; onChange(o.value); setOpen(false); setQ(""); button.current?.focus(); };

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(wrap.current?.querySelectorAll<HTMLElement>("[data-opt]:not([disabled])") ?? []);
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)]?.focus();
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={onKey}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? placeholder}`} onClick={() => setOpen(!open)}
        className={`flex h-11 w-full items-center gap-2.5 rounded-[8px] border bg-base-100 px-3 text-left text-[15px] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${invalid ? "border-error/60" : open ? "border-[var(--border-focus)]" : "border-[var(--border-subtle)] hover:bg-base-200/50"}`}>
        {current?.lead}
        <span className={`min-w-0 flex-1 truncate ${current ? "text-base-content" : "italic text-base-content/45"}`}>{current?.label ?? placeholder}</span>
        {current?.pill}
        <RiArrowDownSLine size={20} className={`shrink-0 text-base-content/45 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
          {searchable && (
            <div className="border-b border-[var(--border-subtle)] p-2">
              <div className="relative">
                <RiSearchLine size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${label}`}
                  className="h-10 w-full rounded-[10px] border border-primary/40 bg-base-100 pl-9 pr-3 text-[15px] outline-none ring-2 ring-primary/10" />
              </div>
            </div>
          )}
          <ul role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
            {shown.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}>
                <button type="button" data-opt disabled={o.disabled} onClick={() => pick(o)}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[15px] outline-none focus-visible:bg-base-200 ${o.disabled ? "cursor-not-allowed text-base-content/40 line-through" : o.value === value ? "bg-primary/10 text-primary" : "text-base-content/85 hover:bg-base-200"}`}>
                  {o.lead}
                  <span className="min-w-0 flex-1 truncate">{o.label}{o.note ? ` ${o.note}` : ""}</span>
                  {o.pill}
                  {o.value === value && <RiCheckLine size={16} className="shrink-0" aria-hidden="true" />}
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-3 text-sm text-base-content/45">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
