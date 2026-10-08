import { useState } from "react";
import { RiAddLine, RiCloseLine, RiMagicLine } from "react-icons/ri";
import { JOB_TITLES, POPULAR_ROLES } from "@/lib/icp/data/job-titles";
import PickerShell from "@/components/agents/targeting/PickerShell";
import { ToggleChip } from "@/components/agents/targeting/Chips";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Job-role picker: popular roles as chips, search over common B2B titles, Enter adds free text. */
export default function TitlePicker({ selected, onToggle, onClear, onClose }: {
  selected: string[]; onToggle: (title: string) => void; onClear: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const isOn = (t: string) => selected.some((s) => same(s, t));
  const matches = q ? JOB_TITLES.filter((t) => t.toLowerCase().includes(q)).slice(0, 40) : POPULAR_ROLES;
  const exact = q && JOB_TITLES.some((t) => same(t, q));

  function enter() {
    const text = query.trim();
    if (!text) return;
    const hit = JOB_TITLES.find((t) => same(t, text)) ?? text;
    if (!isOn(hit)) onToggle(hit);
    setQuery("");
  }

  return (
    <PickerShell label="Add job roles" query={query} onQuery={setQuery} onEnter={enter} onClose={onClose}
      placeholder="Search job titles or write free text…"
      header={selected.length > 0 && (
        <button type="button" onClick={onClear} className="flex w-full items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5 text-left text-sm text-base-content/60 hover:bg-base-200/60">
          <RiCloseLine size={16} /> Clear {selected.length} selected
        </button>
      )}
      footer={<span className="flex items-start gap-2"><RiMagicLine size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />We&apos;ll also match these roles to similar job titles automatically</span>}>
      <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-base-content/45">{q ? "Matching titles" : "Most popular roles"}</p>
      <div className="flex flex-wrap gap-2 px-2 pb-2">
        {q && !exact && (
          <button type="button" data-row onClick={enter}
            className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-primary/50 px-3 py-1 text-sm text-primary hover:bg-primary/5">
            <RiAddLine size={14} /> Add &ldquo;{query.trim()}&rdquo;
          </button>
        )}
        {matches.map((t) => <ToggleChip key={t} label={t} on={isOn(t)} onToggle={() => onToggle(t)} check row />)}
        {q && !matches.length && <p className="px-1 text-sm text-base-content/45">No matching titles. Press Enter to add it as written.</p>}
      </div>
    </PickerShell>
  );
}

