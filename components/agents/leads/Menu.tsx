import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RiArrowDownSLine } from "react-icons/ri";
import { useDismiss } from "./Listbox";

export interface MenuItem { label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

/**
 * A menu rendered in a portal at a fixed position under (right-aligned to) its anchor, so a
 * scroll container never clips it. Closes on outside click, Escape, scroll or resize.
 */
export function FloatingMenu({ anchor, items, onClose, label, width = 240 }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void; label: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  useDismiss(true, [ref, anchorRef], onClose);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    // Positioned directly on the node: it is measured first, so this cannot be render state.
    if (ref.current) {
      ref.current.style.top = `${top}px`;
      ref.current.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))}px`;
    }
  }, [anchor, width]);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const close = () => closeRef.current();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus({ preventScroll: true });
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, []);

  function onKey(e: KeyboardEvent) {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); anchor.focus(); }
    else if (e.key === "Tab") onClose();
  }

  return createPortal(
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: -9999, left: -9999, width, transformOrigin: "top right" }}
      className="pop-in z-[60] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 text-left text-[15px] shadow-[var(--shadow-overlay)]">
      {items.map((it, i) => (
        <button key={i} type="button" role="menuitem" disabled={it.disabled}
          onClick={() => { onClose(); it.onSelect(); }}
          className={`flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left outline-none transition-colors hover:bg-base-200 focus-visible:bg-base-200 disabled:pointer-events-none disabled:opacity-40 ${it.danger ? "text-error" : "text-base-content"}`}>
          {it.icon && <span className={`shrink-0 ${it.danger ? "" : "text-base-content/50"}`}>{it.icon}</span>}
          <span className="min-w-0 flex-1">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** A toolbar button that opens a FloatingMenu ("Export to…", "Enrich"). */
export function MenuButton({ icon, label, items, disabled }: { icon: ReactNode; label: string; items: MenuItem[]; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" aria-haspopup="menu" aria-expanded={!!anchor} disabled={disabled}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3.5 text-[15px] font-medium text-base-content/75 transition-colors hover:bg-base-200 disabled:opacity-50">
        <span className="text-base-content/45">{icon}</span>{label}<RiArrowDownSLine size={16} className={`text-base-content/40 transition-transform ${anchor ? "rotate-180" : ""}`} />
      </button>
      {anchor && <FloatingMenu anchor={anchor} items={items} label={label} onClose={() => setAnchor(null)} width={260} />}
    </>
  );
}
