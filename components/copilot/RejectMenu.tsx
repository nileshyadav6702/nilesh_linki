import { useEffect, useRef, useState } from "react";
import { RiArrowRightSLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";

/**
 * "Why?" after rejecting a lead: a category, then an optional detail. Entirely optional:
 * Esc or a click away closes it and the rejection stands without a reason.
 */

const GROUPS: Array<{ label: string | null; items: string[] }> = [
  { label: "Company", items: ["Competitor", "Wrong industry/type", "Wrong size", "Wrong location"] },
  { label: "Contact", items: ["Wrong title/function", "Wrong seniority", "Known/duplicate"] },
  { label: null, items: ["Data incorrect/outdated", "Signal not relevant", "Other..."] },
];

export default function RejectMenu({ onSave, onClose }: { onSave: (reason: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(true, [wrap], onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const base = category && category !== "Other..." ? category : "Other";
    onSave(detail.trim() ? `${base}: ${detail.trim()}` : base);
  };

  return (
    <div ref={wrap} className="absolute bottom-full left-0 z-40 mb-3 flex items-end gap-3">
      <div role="menu" aria-label="Why reject this lead" className="wizard-rise w-[340px] overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 py-2 shadow-[var(--shadow-overlay)]">
        <div className="border-b border-[var(--border-subtle)] px-5 pb-3 pt-1">
          <div className="text-[17px] font-medium">Why?</div>
          <div className="text-[14px] text-base-content/50">Optional · Esc or click away to skip</div>
        </div>
        {GROUPS.map((g, gi) => (
          <div key={gi} className={gi ? "border-t border-[var(--border-subtle)] pt-1" : "pt-1"}>
            {g.label && <div className="px-5 pb-1 pt-2 text-[13px] font-medium uppercase tracking-[0.04em] text-base-content/45">{g.label}</div>}
            {g.items.map((it) => (
              <button key={it} type="button" role="menuitem" onClick={() => { setCategory(it); setDetail(""); }}
                className={`flex w-full items-center justify-between px-5 py-2.5 text-left text-[17px] transition-colors ${category === it ? "bg-primary/10 text-primary" : "text-base-content/85 hover:bg-base-200"}`}>
                {it} <RiArrowRightSLine size={20} className="text-base-content/45" />
              </button>
            ))}
          </div>
        ))}
      </div>
      {category && (
        <form className="wizard-rise mb-2 w-[340px] space-y-3 rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-3 shadow-[var(--shadow-overlay)]"
          onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input autoFocus value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Why is this lead not a fit?" aria-label={`${category}: details`}
            className="h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3 text-[15px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
          <div className="flex justify-end">
            <button type="submit" className="h-10 rounded-[8px] bg-base-content px-4 text-[15px] font-medium text-base-100 hover:opacity-90">Save reason</button>
          </div>
        </form>
      )}
    </div>
  );
}
