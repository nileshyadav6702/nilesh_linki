import type { ReactNode } from "react";
import { RiCheckLine } from "react-icons/ri";

/** Wizard-only building blocks: the stepper, step headings, option cards and caption labels. */

export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-5 py-4">
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={label} className={`flex items-center gap-2 text-sm ${i < steps.length - 1 ? "flex-1" : ""}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${on ? "bg-base-content text-base-100" : done ? "bg-primary/10 text-primary" : "bg-base-200 text-base-content/45"}`}>
              {done ? <RiCheckLine size={14} /> : i + 1}
            </span>
            <span className={`whitespace-nowrap ${on ? "font-semibold text-base-content" : done ? "text-primary" : "text-base-content/45"}`}>{label}</span>
            {i < steps.length - 1 && <span className={`mx-2 hidden h-px min-w-6 flex-1 sm:block ${done ? "bg-primary/50" : "bg-[var(--border-subtle)]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Big centered serif question + muted subtitle that opens each step. */
export function StepHeading({ title, subtitle, align = "center" }: { title: ReactNode; subtitle?: ReactNode; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <h2 className="font-display text-[30px] leading-[1.15] tracking-[-0.5px] text-base-content">{title}</h2>
      {subtitle && <p className="mt-2 text-[15px] text-base-content/55">{subtitle}</p>}
    </div>
  );
}

/** Uppercase caption section label ("CAMPAIGN GOAL"). */
export function Caps({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[12px] font-semibold uppercase tracking-[1.2px] text-base-content/60 ${className}`}>{children}</div>;
}

export function RecommendedBadge() {
  return <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-content">Recommended</span>;
}

/** A selectable card: coral hairline + tint when chosen. */
export function OptionCard({ selected, onClick, icon, title, text, badge, corner, className = "" }: {
  selected: boolean; onClick: () => void; icon?: ReactNode; title: ReactNode; text?: ReactNode; badge?: ReactNode; corner?: ReactNode; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`rounded-[12px] border p-4 text-left transition-colors ${selected ? "border-primary/60 bg-primary/5 ring-2 ring-primary/15" : "border-[var(--border-subtle)] bg-base-100 hover:border-[var(--border-strong)]"} ${className}`}>
      {(icon || badge || corner) && <div className="mb-3 flex items-start justify-between gap-2">{icon ?? <span />}<span className="flex items-center gap-1.5">{corner}{badge}</span></div>}
      <div className="text-[15px] font-semibold text-base-content">{title}</div>
      {text && <div className="mt-1 text-[13px] leading-relaxed text-base-content/55">{text}</div>}
    </button>
  );
}

/** Radio-style row card used for single choices with a description. */
export function RadioCard({ selected, onClick, title, text }: { selected: boolean; onClick: () => void; title: ReactNode; text?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-[12px] border px-4 py-3.5 text-left transition-colors ${selected ? "border-primary/60 bg-primary/5" : "border-[var(--border-subtle)] bg-base-100 hover:border-[var(--border-strong)]"}`}>
      <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary" : "border-base-content/25"}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0"><span className="block text-sm font-medium text-base-content">{title}</span>{text && <span className="mt-0.5 block text-xs text-base-content/55">{text}</span>}</span>
    </button>
  );
}

/** The white content sheet each step sits in. */
export function StepSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-4xl space-y-6 rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-5 py-8 sm:px-10 sm:py-10 ${className}`}>{children}</div>;
}
