import type { ReactNode } from "react";
import { flamesFor } from "@/lib/signals/scoring";
import { motion } from "motion/react";

/** Shared building blocks for the AI SDR screens, following the Linki design system. */

export const inputCls = "w-full h-11 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15px] text-base-content outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)] transition";
export const textareaCls = "w-full rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-[15px] text-base-content outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)] transition";
export const primaryBtn = "inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-[10px] text-[15.5px] font-semibold bg-primary shadow-[0_6px_16px_-8px_var(--color-primary)] text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-[#e6dfd8] disabled:text-[#8e8b82] transition-colors shrink-0";
export const secondaryBtn = "inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-[10px] text-[15.5px] font-medium border border-[var(--border-subtle)] bg-base-100 text-base-content hover:bg-base-200 disabled:opacity-50 transition-colors shrink-0";
export const ghostBtn = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[8px] text-[14.5px] font-medium text-base-content/60 hover:text-base-content hover:bg-base-200 disabled:opacity-50 transition-colors";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="mb-2 text-[14.5px] font-medium text-base-content/45">{eyebrow}</p>
        <h1 className="text-[26px] font-semibold leading-[1.15] text-base-content">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[16px] text-base-content/65">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[16px] border border-[var(--border-subtle)] bg-base-300 p-6 ${className}`}>{children}</div>;
}

/** Canvas card with a hairline border, for data-dense content (tables, lists, forms). Card is the cream feature card. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[16px] border border-[var(--border-subtle)] bg-base-100 ${className}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-[var(--border-strong)] bg-base-100 px-6 py-14 text-center">
      <p className="text-[18px] font-medium text-base-content/80">{title}</p>
      {children && <div className="mt-2 text-[15px] text-base-content/45">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, required, children }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[15.5px] font-medium text-base-content/80">{label}{required && <span className="text-primary"> *</span>}</span>
      {children}
      {hint && <span className="block text-[13.5px] text-base-content/45">{hint}</span>}
    </label>
  );
}

const VERDICT: Record<string, string> = {
  strong: "bg-success/10 text-success",
  possible: "bg-warning/10 text-warning",
  poor: "bg-error/10 text-error",
};

export function ScoreBadge({ score, verdict }: { score: number | null | undefined; verdict?: string | null }) {
  if (score === null || score === undefined) return <span className="text-[13.5px] text-base-content/35">Unscored</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13.5px] font-semibold tabular-nums ${VERDICT[verdict ?? ""] ?? "bg-base-200 text-base-content/70"}`}>
      {Math.round(score)}
      {verdict && <span className="font-medium capitalize opacity-80">· {verdict}</span>}
    </span>
  );
}

/** Lead score as 1-3 flames, the way sales teams scan a list. */
export function Flames({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-[13.5px] text-base-content/30">—</span>;
  const n = flamesFor(score);
  return (
    <span className="inline-flex items-center gap-0.5" title={`Lead score ${Math.round(score)}`} aria-label={`Lead score ${Math.round(score)}`}>
      {[1, 2, 3].map((i) => (
        <svg key={i} width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
          <path d="M6 0c.6 2.4 4.8 4.4 4.8 8.2A4.8 4.8 0 0 1 1.2 8.2C1.2 6 2.8 4.6 3.6 3.4c.3 1.5 1.1 2.3 2 2.6C5.4 4 5.4 2 6 0Z" fill={i <= n ? "var(--warning-solid, #e8590c)" : "currentColor"} opacity={i <= n ? 1 : 0.15} />
        </svg>
      ))}
    </span>
  );
}

export const SIGNAL_LABEL: Record<string, string> = {
  competitor_engagement: "Competitor engagement",
  influencer_engagement: "Influencer engagement",
  keyword_engagement: "Topic activity",
  own_content_engagement: "Engaged with you",
  job_change: "Job change",
  hiring: "Hiring",
  funding: "Funding",
  website_visit: "Website visit",
  lookalike: "Lookalike",
  existing_list: "Existing list",
  linkedin_import: "LinkedIn import",
  technology: "Technology",
  product_intent: "Product intent",
  custom: "Custom",
};

export function SignalChip({ type }: { type: string }) {
  return <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-base-200 px-2 py-0.5 text-[12.5px] font-medium text-base-content/70">{SIGNAL_LABEL[type] ?? type}</span>;
}

const STATUS: Record<string, string> = {
  new: "text-base-content/60", qualified: "text-info", drafted: "text-warning", approved: "text-info",
  enrolled: "text-success", disqualified: "text-base-content/35", skipped: "text-base-content/35",
  needs_data: "text-warning",
  active: "text-success", paused: "text-warning", draft: "text-base-content/50",
};
const STATUS_TEXT: Record<string, string> = { needs_data: "Needs profile data" };

export function StatusDot({ status }: { status: string | null | undefined }) {
  const s = status ?? "new";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13.5px] font-medium ${STATUS_TEXT[s] ? "" : "capitalize"} ${STATUS[s] ?? "text-base-content/60"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS_TEXT[s] ?? s}
    </span>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/* ─── Agents section kit: icon tiles, tabs, toggles, stat tiles, avatars ───────────────────── */

export type Tone = "coral" | "teal" | "amber" | "ink" | "success" | "error" | "linkedin" | "indigo" | "violet";

const TONE: Record<Tone, string> = {
  coral: "bg-primary/10 text-primary",
  teal: "bg-accent/15 text-[#2f8a78]",
  amber: "bg-[#e8a55a]/15 text-[#b8742a]",
  ink: "bg-base-200 text-base-content/70",
  success: "bg-success/12 text-[#3a8c4f]",
  error: "bg-error/10 text-error",
  linkedin: "bg-[#0a66c2]/10 text-[#0a66c2]",
  indigo: "bg-[#6366f1]/12 text-[#5457e0]",
  violet: "bg-[#c026d3]/10 text-[#b02ac6]",
};

/** A soft-tinted rounded square holding an icon — the leading mark of rows and cards. */
export function IconTile({ icon, tone = "coral", size = 40, className = "" }: { icon: ReactNode; tone?: Tone; size?: 32 | 36 | 40 | 48; className?: string }) {
  const dim = { 32: "h-8 w-8 rounded-[8px]", 36: "h-9 w-9 rounded-[8px]", 40: "h-10 w-10 rounded-[10px]", 48: "h-12 w-12 rounded-[12px]" }[size];
  return <span className={`inline-flex shrink-0 items-center justify-center ${dim} ${TONE[tone]} ${className}`}>{icon}</span>;
}

/** badge-pill: small cream label. `tone` tints it for status. */
export function Pill({ children, tone, className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  const cls = tone ? TONE[tone] : "bg-base-200 text-base-content/70";
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[14px] font-medium ${cls} ${className}`}>{children}</span>;
}

/** Serif section heading with an optional subtitle and right-side actions. */
export function SectionHeading({ title, subtitle, actions, className = "" }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[21px] font-semibold leading-[1.25] text-base-content">{title}</h2>
        {subtitle && <p className="mt-1 text-[16px] text-base-content/65">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Underlined tab row. `counts` shows a small number chip after a tab label. */
export function TabBar<T extends string>({ tabs, value, onChange, counts = {}, icons = {} }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; counts?: Partial<Record<T, number>>; icons?: Partial<Record<T, ReactNode>> }) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto border-b border-[var(--border-subtle)]">
      {tabs.map((t) => {
        const on = t === value;
        return (
          <button key={t} role="tab" aria-selected={on} type="button" onClick={() => onChange(t)}
            className={`relative inline-flex items-center gap-2.5 whitespace-nowrap px-5 pb-3.5 pt-2 text-[18px] transition-colors ${on ? "text-base-content" : "text-base-content/45 hover:text-base-content/75"}`}>
            {icons[t] && <span className={on ? "text-primary" : ""}>{icons[t]}</span>}
            {t}
            {counts[t] !== undefined && <span className="rounded-[6px] bg-base-200 px-2.5 py-0.5 text-[15px] tabular-nums text-base-content/75">{counts[t]}</span>}
            {on && <motion.span layoutId="agent-tab-underline" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-base-content/80" />}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented filter chips (Activity filters, leads status). */
export function Segmented<T extends string>({ options, value, onChange, counts = {}, labels = {} }: { options: readonly T[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>>; labels?: Partial<Record<T, ReactNode>> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3.5 text-[15px] font-medium transition-colors ${on ? "border-primary/40 bg-primary/10 text-primary" : "border-[var(--border-subtle)] bg-base-100 text-base-content/65 hover:text-base-content"}`}>
            {labels[o] ?? <span className="capitalize">{o}</span>}
            {counts[o] !== undefined && <span className={`rounded-full px-1.5 text-[12.5px] tabular-nums ${on ? "bg-primary/15" : "bg-base-200"}`}>{counts[o]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Coral on/off switch. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${on ? "border-primary bg-primary" : "border-[var(--border-subtle)] bg-base-200"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[22px]" : "translate-x-[3px]"}`} />
    </button>
  );
}

/** A KPI tile: label, big tabular number, optional hint and corner icon. */
export function StatTile({ label, value, hint, icon, tone = "ink", className = "" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={`wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-5 transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.2)] ${className}`}>
      <div className="flex items-center justify-between gap-2 text-[15px] font-medium text-base-content/65">
        <span>{label}</span>{icon && <IconTile icon={icon} tone={tone} size={36} />}
      </div>
      <div className="mt-3 text-[34px] font-semibold leading-none tabular-nums text-base-content">{value}</div>
      {hint && <div className="mt-2 text-[14px] text-base-content/55">{hint}</div>}
    </div>
  );
}

/** Round avatar: the photo when there is one, otherwise initials on cream. */
export function Avatar({ name, src, size = 36 }: { name: string | null | undefined; src?: string | null; size?: number }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover ring-1 ring-[var(--border-subtle)]" />;
  }
  return <span style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#efe9de] font-semibold text-base-content/70">{initials}</span>;
}

/** Coral-tinted note band ("Nothing is sent without your green light…"). */
export function Callout({ icon, title, children, tone = "coral" }: { icon?: ReactNode; title?: ReactNode; children?: ReactNode; tone?: Tone }) {
  return (
    <div className={`flex items-start gap-3 rounded-[12px] px-5 py-4 text-[16px] ${TONE[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 leading-relaxed">{title && <span className="font-semibold">{title} </span>}<span className="opacity-90">{children}</span></div>
    </div>
  );
}

/** Comma/line separated text ↔ string list, for simple list editing. */
export const toList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
export const fromList = (l: string[] | undefined) => (l ?? []).join(", ");

/** "in 3h" for a future timestamp; "due" once it has passed. */
export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const s = (t - Date.now()) / 1000;
  if (s <= 60) return "due";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

/** A source that has never run is scheduled for now. It is not late. */
export function nextRunLabel(nextAt: string | null | undefined, lastAt: string | null | undefined): string {
  if (!nextAt) return "Not scheduled";
  if (!lastAt && timeUntil(nextAt) === "due") return "Scheduled now";
  return timeUntil(nextAt);
}

export function sourcingLabel(status: string): string {
  if (status === "active") return "Lead sourcing on";
  if (status === "draft") return "Lead sourcing not started";
  return "Lead sourcing paused";
}

export function outreachLabel(on: boolean): string {
  return on ? "Outreach on" : "Outreach paused";
}

/** One independent on/off control. The change handler should touch only this switch. */
export function RunSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <label className={`inline-flex h-10 items-center gap-2 rounded-[8px] border px-3 ${on ? "border-success/30 bg-success/10" : "border-[var(--border-subtle)] bg-base-100"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-success" : "bg-base-content/25"}`} />
      <span className="text-[15px] font-medium text-base-content">{label}</span>
      <span className={`text-[13.5px] font-medium ${on ? "text-success" : "text-base-content/40"}`}>{on ? "On" : "Off"}</span>
      <input type="checkbox" className="toggle toggle-sm toggle-success" checked={on} onChange={onChange} aria-label={label} />
    </label>
  );
}

/** Name of the attached sender. Accounts that exist but are not on this agent are not "no sender". */
export function senderLine(linkedinName: string | null | undefined, emailFrom: string | null | undefined, pool: { linkedin: number; email: number }): string {
  const attached = linkedinName || emailFrom;
  if (attached) return attached;
  if (pool.linkedin + pool.email > 0) return "No sender attached";
  return "No sender yet";
}
