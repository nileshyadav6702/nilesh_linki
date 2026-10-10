import type { ActivityCounts } from "@/lib/agents/activity-feed";
import { CATEGORY, FILTERS, type ActivityFilter } from "./meta";

/** Category filter chips with each category's total. The selected chip is coral. */
export default function ActivityChips({ value, counts, onChange }: { value: ActivityFilter; counts: ActivityCounts | null; onChange: (f: ActivityFilter) => void }) {
  return (
    <div className="flex flex-wrap gap-3" role="tablist" aria-label="Activity type">
      {FILTERS.map((f) => {
        const on = f === value;
        const n = counts?.[f];
        return (
          <button key={f} type="button" role="tab" aria-selected={on} onClick={() => onChange(f)}
            className={`inline-flex h-11 items-center gap-2.5 rounded-[8px] border px-4 text-[16px] transition-colors ${on
              ? "border-primary/55 bg-primary/[0.06] text-primary"
              : "border-[var(--border-subtle)] bg-base-100 text-base-content/70 hover:bg-base-200 hover:text-base-content"}`}>
            {f !== "all" && <span className={on ? "" : "text-base-content/55"}>{CATEGORY[f].icon(18)}</span>}
            {f === "all" ? "All" : CATEGORY[f].label}
            <span className={`min-w-7 rounded-[6px] px-2 py-0.5 text-center text-[15px] tabular-nums ${on ? "bg-primary/12 text-primary" : "bg-base-200 text-base-content/70"}`}>
              {n ?? "–"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
