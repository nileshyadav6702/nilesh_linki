import { useRef, useState } from "react";
import { RiArrowDownSLine, RiAtLine, RiCloseCircleLine, RiCloseLine, RiFileDownloadLine, RiFilter3Line, RiSearchLine, RiShareBoxLine, RiSparkling2Line } from "react-icons/ri";
import { inputCls, SIGNAL_LABEL } from "@/components/agents/ui";
import FilterPopover from "./FilterPopover";
import Listbox from "./Listbox";
import { MenuButton } from "./Menu";
import { APPROVAL_OPTIONS, DEFAULT_SORT, EMAIL_OPTIONS, labelOf, PHONE_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, STEP_OPTIONS, type Facets, type Filters } from "./types";

interface Chip { key: keyof Filters; label: string; reset: string }

function chipsOf(f: Filters): Chip[] {
  const out: Chip[] = [];
  if (f.step) out.push({ key: "step", label: `Step: ${labelOf(STEP_OPTIONS, f.step)}`, reset: "" });
  if (f.approval) out.push({ key: "approval", label: `Approval: ${labelOf(APPROVAL_OPTIONS, f.approval)}`, reset: "" });
  if (f.email) out.push({ key: "email", label: `Email: ${labelOf(EMAIL_OPTIONS, f.email)}`, reset: "" });
  if (f.phone) out.push({ key: "phone", label: `Phone: ${labelOf(PHONE_OPTIONS, f.phone)}`, reset: "" });
  if (f.signal) out.push({ key: "signal", label: `Signal: ${SIGNAL_LABEL[f.signal] ?? f.signal}`, reset: "" });
  if (f.sort !== DEFAULT_SORT) out.push({ key: "sort", label: `Sort: ${labelOf(SORT_OPTIONS, f.sort)}`, reset: DEFAULT_SORT });
  return out;
}

export interface ToolbarActions {
  selected: number; busy: boolean; pageWithoutEmail: number;
  exportSelected: () => void; exportAll: () => void; findSelected: () => void; findPage: () => void; rejectSelected: () => void;
}

/** Search, status, "Add filters" popover, lead count, export/enrich menus and the active-filter chips. */
export default function LeadsToolbar({ filters, patch, clearFilters, q, search, total, facets, actions }: {
  filters: Filters; patch: (p: Partial<Filters>) => void; clearFilters: () => void; q: string; search: (v: string) => void;
  total: number; facets: Facets | null; actions: ToolbarActions;
}) {
  const [open, setOpen] = useState(false);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const chips = chipsOf(filters);
  const active = chips.filter((c) => c.key !== "sort").length;
  const lit = open || active > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35" size={16} />
          <input className={`${inputCls} pl-9`} placeholder="Search leads" aria-label="Search leads" value={q} onChange={(e) => search(e.target.value)} />
        </div>
        <Listbox label="Lead status" className="w-full sm:w-52" value={filters.status} onChange={(v) => patch({ status: v })}
          options={STATUS_OPTIONS.map((o) => ({ ...o, count: facets?.status[o.value] }))} />
        <div className="relative">
          <button ref={filterBtn} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className={`inline-flex h-10 items-center gap-2 rounded-[8px] border px-3.5 text-sm font-medium transition-colors ${lit ? "border-primary bg-primary/5 text-primary" : "border-[var(--border-subtle)] bg-base-100 text-base-content/75 hover:bg-base-200"}`}>
            <RiFilter3Line size={15} /> Add filters
            {active > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-content">{active}</span>}
            <RiArrowDownSLine size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <FilterPopover filters={filters} facets={facets} onChange={patch} onClear={clearFilters} onClose={() => setOpen(false)} anchorRef={filterBtn} />}
        </div>
        <span className="px-1 text-[13px] tabular-nums text-base-content/45" aria-live="polite">{total} lead{total === 1 ? "" : "s"}</span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {actions.selected > 0 && (
            <button type="button" disabled={actions.busy} onClick={actions.rejectSelected}
              className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3.5 text-sm font-medium text-base-content/75 transition-colors hover:border-error/40 hover:text-error disabled:opacity-50">
              <RiCloseLine size={15} /> Reject ({actions.selected})
            </button>
          )}
          <MenuButton icon={<RiShareBoxLine size={15} />} label="Export to…" disabled={actions.busy} items={[
            { label: `CSV of selected leads${actions.selected ? ` (${actions.selected})` : ""}`, icon: <RiFileDownloadLine size={16} />, onSelect: actions.exportSelected, disabled: !actions.selected },
            { label: `CSV of all filtered leads (${total})`, icon: <RiFileDownloadLine size={16} />, onSelect: actions.exportAll, disabled: !total },
          ]} />
          <MenuButton icon={<RiSparkling2Line size={15} />} label="Enrich" disabled={actions.busy} items={[
            { label: `Find emails for selected${actions.selected ? ` (${actions.selected})` : ""}`, icon: <RiAtLine size={16} />, onSelect: actions.findSelected, disabled: !actions.selected },
            { label: `Find emails for all on this page (${actions.pageWithoutEmail})`, icon: <RiAtLine size={16} />, onSelect: actions.findPage, disabled: !actions.pageWithoutEmail },
          ]} />
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 pl-3 pr-1.5 text-[13px] font-medium text-primary">
              {c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => patch({ [c.key]: c.reset })} className="rounded-full p-0.5 hover:bg-primary/15"><RiCloseCircleLine size={16} /></button>
            </span>
          ))}
          <button type="button" onClick={clearFilters} className="px-1.5 text-[13px] font-medium text-base-content/65 hover:text-base-content">Clear all</button>
        </div>
      )}
    </div>
  );
}
