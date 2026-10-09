import { useState, type ReactNode } from "react";
import { RiArrowDownLine, RiArrowUpDownLine, RiArrowUpLine, RiInformationLine } from "react-icons/ri";
import type { SourceCategory } from "@/lib/insights/report";

/** Building blocks of the Insights page: cards, info tips, sortable headers, chips and rates. */

export const HELP = {
  contacted: "Leads who received at least one connection request (with or without a note), LinkedIn message, voice message or email during the period.",
  replied: "Leads who replied during the period. The rate is out of leads who received a message (connection note, LinkedIn message, voice message or email). Connection requests without a note don't count.",
  interested: "Leads who replied with interest. The rate is out of leads who replied.",
  accepted: "Connection requests accepted, out of those sent during the period.",
};

export const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export function Card({ title, sub, children, className = "" }: { title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`insights-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-[var(--border-subtle)] px-6 py-5">
        <div role="heading" aria-level={2} className="text-[19px] font-medium text-base-content">{title}</div>
        {sub && <div className="text-[15px] text-base-content/50">{sub}</div>}
      </div>
      {children}
    </section>
  );
}

/** ⓘ with a hover / focus card. `align` keeps it on screen near the right edge. */
export function InfoTip({ text, align = "center" }: { text: string; align?: "center" | "right" }) {
  const pos = align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className="group/tip relative inline-flex align-middle">
      <button type="button" aria-label={text} className="inline-flex text-base-content/45 outline-none hover:text-base-content/70 focus-visible:text-base-content/70">
        <RiInformationLine size={17} />
      </button>
      <span role="tooltip" className={`pointer-events-none invisible absolute top-full z-40 mt-2 w-[400px] max-w-[80vw] rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-left whitespace-normal text-[15px] font-normal [text-transform:none] leading-relaxed tracking-normal text-base-content/85 opacity-0 shadow-[var(--shadow-overlay)] transition-opacity duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 ${pos}`}>
        {text}
      </span>
    </span>
  );
}

export type SortDir = "asc" | "desc";
export function useSort<K extends string>(initial: K | null, dir: SortDir = "desc") {
  const [sort, setSort] = useState<{ key: K | null; dir: SortDir }>({ key: initial, dir });
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const apply = <R,>(rows: R[], get: (r: R, k: K) => number | string) => {
    if (!sort.key) return rows;
    const k = sort.key, m = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => { const x = get(a, k), y = get(b, k); return (x < y ? -1 : x > y ? 1 : 0) * m; });
  };
  return { sort, toggle, apply };
}

export function Th({ children, align = "left", sortKey, sort, onSort, help, helpAlign, className = "" }: {
  children: ReactNode; align?: "left" | "right"; sortKey?: string; sort?: { key: string | null; dir: SortDir }; onSort?: (k: string) => void; help?: string; helpAlign?: "center" | "right"; className?: string;
}) {
  const on = !!sortKey && sort?.key === sortKey;
  const Icon = on ? (sort!.dir === "desc" ? RiArrowDownLine : RiArrowUpLine) : RiArrowUpDownLine;
  return (
    <th scope="col" aria-sort={on ? (sort!.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`h-[52px] whitespace-nowrap px-6 text-[13px] font-semibold [text-transform:uppercase] tracking-[0.04em] text-base-content/60 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <span className={`inline-flex items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
        {sortKey ? (
          <button type="button" onClick={() => onSort?.(sortKey)} className={`inline-flex items-center gap-1 [text-transform:uppercase] tracking-[0.04em] hover:text-base-content ${on ? "text-base-content/80" : ""}`}>
            {children}<Icon size={16} className={on ? "" : "text-base-content/35"} />
          </button>
        ) : children}
        {help && <InfoTip text={help} align={helpAlign} />}
      </span>
    </th>
  );
}

/** A number with its rate under it ("—" when there is nothing to divide by). */
export function Num({ n, of, muted, bold = true }: { n: number; of?: number; muted?: boolean; bold?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`text-[18px] tabular-nums ${bold ? "font-semibold" : ""} ${muted && !n ? "text-base-content/35" : "text-base-content"}`}>{n.toLocaleString()}</span>
      {of !== undefined && <span className="mt-0.5 text-[13px] tabular-nums text-base-content/45">{rate(n, of)}</span>}
    </span>
  );
}

const CHIP: Record<SourceCategory, { label: string; cls: string }> = {
  buying_events: { label: "Buying events", cls: "bg-[#fff1d6] text-[#c9700a]" },
  topic: { label: "Topic engagement", cls: "bg-[#f6e6ff] text-[#9b27d8]" },
  competitor: { label: "Competitor engagement", cls: "bg-[#ffe6ea] text-[#e0244f]" },
  influencer: { label: "Influencer engagement", cls: "bg-[#e3efff] text-[#2d6be0]" },
  own_content: { label: "Your content", cls: "bg-[#dff5ef] text-[#17876b]" },
  website: { label: "Website visit", cls: "bg-[#e8e9ff] text-[#4b4fd6]" },
  lookalike: { label: "Warm lookalike", cls: "bg-[#e5f5df] text-[#3a8c2f]" },
  imported: { label: "Imported", cls: "bg-base-200 text-base-content/70" },
  other: { label: "Other", cls: "bg-base-200 text-base-content/70" },
};
export const categoryLabel = (c: SourceCategory) => CHIP[c].label;

export function CategoryChip({ category }: { category: SourceCategory }) {
  const c = CHIP[category];
  return <span className={`inline-flex h-7 items-center whitespace-nowrap rounded-[4px] px-2.5 text-[15px] ${c.cls}`}>{c.label}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-[4px] px-2 text-[13px] capitalize ${active ? "bg-[#5cbf8b] text-white" : "bg-base-200 text-base-content/60"}`}>{status}</span>;
}

/** "Loading insights…" pill floating over the dimmed content. */
export function LoadingPill() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[210px] z-30 -translate-x-1/2">
      <div className="insights-rise flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-base-100 px-5 py-3 text-[17px] text-base-content shadow-[var(--shadow-overlay)]">
        <span aria-hidden className="insights-slashes font-semibold italic tracking-[-0.12em] text-primary">{"///"}</span> Loading insights...
      </div>
    </div>
  );
}
