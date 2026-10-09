import { useId, type ReactNode } from "react";
import { RiArrowDownSLine } from "react-icons/ri";

/** Collapsible targeting section: icon, UPPERCASE label + count, a one-line summary, chevron. */
export function SectionCard({ icon, label, count, summary, open, onToggle, children }: {
  icon: ReactNode; label: string; count: number; summary: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center gap-4 rounded-[12px] px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <span className="shrink-0 text-base-content/50" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold uppercase tracking-[0.06em] text-base-content/60">{label}</span>
            {count > 0 && <span className="rounded-[6px] border border-primary/30 px-1.5 text-[12.5px] tabular-nums text-primary">{count}</span>}
          </span>
          <span className={`mt-1 block truncate text-[15px] ${count > 0 ? "text-base-content" : "text-base-content/45"}`}>{summary}</span>
        </span>
        <RiArrowDownSLine size={18} aria-hidden="true" className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="wizard-rise border-t border-[var(--border-subtle)] px-5 py-4">{children}</div>}
    </section>
  );
}

/** Larger collapsible block with a title and description (ICP filtering, optional targeting). */
export function PlainSection({ title, description, open, onToggle, children }: { title: string; description: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <section className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center gap-4 rounded-[12px] px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-medium text-base-content">{title}</span>
          <span className="mt-1 block text-[15px] text-base-content/55">{description}</span>
        </span>
        <RiArrowDownSLine size={18} aria-hidden="true" className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="wizard-rise px-5 pb-5">{children}</div>}
    </section>
  );
}
