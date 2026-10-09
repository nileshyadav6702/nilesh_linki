import { useState, type ReactNode } from "react";
import { RiArrowDownSLine } from "react-icons/ri";
import { IconTile, type Tone } from "@/components/agents/ui";

/** Shared pieces of the agent Settings tab and its sender drawers. */

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** working_days "1,2,3,4,5" (1 = Monday … 7 = Sunday) → set of numbers. */
export function parseDays(s: string | null | undefined): Set<number> {
  return new Set((s || "1,2,3,4,5").split(",").map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 7));
}

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (h === 24) return "12:00 AM (midnight)";
  return `${hh % 12 === 0 ? 12 : hh % 12}:00 ${hh < 12 ? "AM" : "PM"}`;
}

/** Collapsible settings section with a tinted icon, title, summary pill and subtitle. */
export function SettingsSection({ icon, tone, title, pill, subtitle, defaultOpen = false, children }: {
  icon: ReactNode; tone: Tone; title: ReactNode; pill?: ReactNode; subtitle?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`flex w-full items-center gap-4 px-6 py-5 text-left ${open ? "border-b border-[var(--border-subtle)] bg-primary/[0.03]" : ""}`}>
        <IconTile icon={icon} tone={tone} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold text-base-content">{title}</span>
            {pill && <span className="rounded-full bg-base-200 px-3 py-0.5 text-[13px] font-medium text-base-content/70">{pill}</span>}
          </span>
          {subtitle && <span className="mt-0.5 block text-[15px] text-base-content/60">{subtitle}</span>}
        </span>
        <RiArrowDownSLine size={22} className={`shrink-0 text-base-content/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="wizard-rise px-6 py-6">{children}</div>}
    </section>
  );
}

/** Usage bar: "Used today X / N". */
export function UsageBar({ used, limit, label = "Used today" }: { used: number; limit: number; label?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-base-200"><div className={`h-full rounded-full ${pct >= 100 ? "bg-error" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
      <div className="mt-1.5 text-xs text-base-content/55">{label} <span className="font-semibold tabular-nums text-success">{used} / {limit}</span></div>
    </div>
  );
}
