import { useRef, type ReactNode } from "react";
import { RiCloseLine } from "react-icons/ri";
import { SIGNAL_LABEL } from "@/components/agents/ui";
import Listbox, { useDismiss } from "./Listbox";
import { APPROVAL_OPTIONS, EMAIL_OPTIONS, PHONE_OPTIONS, SORT_OPTIONS, STEP_OPTIONS, type Facets, type Filters } from "./types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[13.5px] font-semibold uppercase tracking-[0.08em] text-base-content/50">{title}</h3>
      {children}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1.5"><span className="block text-[14.5px] text-base-content/70">{label}</span>{children}</div>;
}

/** "Add filters" popover: campaign step, approval, enrichment, signal type and sort order. */
export default function FilterPopover({ filters, facets, onChange, onClear, onClose, anchorRef }: {
  filters: Filters; facets: Facets | null; onChange: (patch: Partial<Filters>) => void; onClear: () => void; onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, [ref, anchorRef], onClose);
  const signals = facets?.signal ?? [];
  const signalOptions = [
    { value: "", label: "All signals" },
    ...signals.map((s) => ({ value: s.type, label: `${SIGNAL_LABEL[s.type] ?? s.type} (${s.count})` })),
    // Keep the active choice visible even if it no longer has matches.
    ...(filters.signal && !signals.some((s) => s.type === filters.signal) ? [{ value: filters.signal, label: `${SIGNAL_LABEL[filters.signal] ?? filters.signal} (0)` }] : []),
  ];

  return (
    <div ref={ref} role="dialog" aria-label="Lead filters"
      className="absolute left-0 top-full z-40 mt-2 w-[min(520px,calc(100vw-32px))] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-overlay)]">
      <button type="button" onClick={onClose} aria-label="Close filters" className="absolute right-3 top-3 rounded-[6px] p-1 text-base-content/45 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={18} /></button>
      <div className="space-y-5">
        <Section title="Campaign">
          <Labelled label="Step">
            <Listbox label="Campaign step" value={filters.step} onChange={(v) => onChange({ step: v })}
              options={STEP_OPTIONS.map((o) => ({ ...o, count: facets?.step[o.value || "all"] }))} />
          </Labelled>
        </Section>
        <Section title="Approval">
          <Listbox label="Approval" value={filters.approval} onChange={(v) => onChange({ approval: v })} options={APPROVAL_OPTIONS} />
        </Section>
        <Section title="Enrichment">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Email"><Listbox label="Email enrichment" value={filters.email} onChange={(v) => onChange({ email: v })} options={EMAIL_OPTIONS} /></Labelled>
            <Labelled label="Phone"><Listbox label="Phone enrichment" value={filters.phone} onChange={(v) => onChange({ phone: v })} options={PHONE_OPTIONS} /></Labelled>
          </div>
        </Section>
        <Section title="Signal">
          <Labelled label="Type"><Listbox label="Signal type" value={filters.signal} onChange={(v) => onChange({ signal: v })} options={signalOptions} /></Labelled>
        </Section>
        <Section title="Sort order">
          <Listbox label="Sort order" value={filters.sort} onChange={(v) => onChange({ sort: v })} options={SORT_OPTIONS} />
        </Section>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-4 text-[15px]">
        <button type="button" onClick={onClear} className="font-medium text-base-content/70 underline underline-offset-2 hover:text-base-content">Clear All</button>
        <button type="button" onClick={onClose} className="font-medium text-base-content/60 hover:text-base-content">Close</button>
      </div>
    </div>
  );
}
