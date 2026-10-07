import type { ReactNode } from "react";

/** Shared building blocks for the AI SDR screens, following the Linki design system. */

export const inputCls = "w-full h-10 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 text-sm outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)] transition";
export const textareaCls = "w-full rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)] transition";
export const primaryBtn = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-[10px] text-sm font-semibold bg-primary text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors shrink-0";
export const secondaryBtn = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-[10px] text-sm font-medium border border-[var(--border-subtle)] bg-base-100 hover:border-[var(--border-strong)] disabled:opacity-50 transition-colors shrink-0";
export const ghostBtn = "inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-[8px] text-xs font-medium text-base-content/60 hover:text-base-content hover:bg-base-200 disabled:opacity-50 transition-colors";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="mb-2 text-[13px] font-medium text-base-content/45">{eyebrow}</p>
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-.03em] text-base-content">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-base-content/50">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-raised)] ${className}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-base-100 px-6 py-14 text-center">
      <p className="text-sm font-medium text-base-content/70">{title}</p>
      {children && <div className="mt-2 text-sm text-base-content/45">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-base-content/70">{label}</span>
      {children}
      {hint && <span className="block text-xs text-base-content/45">{hint}</span>}
    </label>
  );
}

const VERDICT: Record<string, string> = {
  strong: "bg-success/10 text-success",
  possible: "bg-warning/10 text-warning",
  poor: "bg-error/10 text-error",
};

export function ScoreBadge({ score, verdict }: { score: number | null | undefined; verdict?: string | null }) {
  if (score === null || score === undefined) return <span className="text-xs text-base-content/35">Unscored</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${VERDICT[verdict ?? ""] ?? "bg-base-200 text-base-content/70"}`}>
      {Math.round(score)}
      {verdict && <span className="font-medium capitalize opacity-80">· {verdict}</span>}
    </span>
  );
}

/** Lead score as 1-3 flames, the way sales teams scan a list. */
export function Flames({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-xs text-base-content/30">—</span>;
  const n = score >= 70 ? 3 : score >= 50 ? 2 : 1;
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
  return <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-base-200 px-2 py-0.5 text-[11px] font-medium text-base-content/70">{SIGNAL_LABEL[type] ?? type}</span>;
}

const STATUS: Record<string, string> = {
  new: "text-base-content/60", qualified: "text-info", drafted: "text-warning", approved: "text-info",
  enrolled: "text-success", disqualified: "text-base-content/35", skipped: "text-base-content/35",
  active: "text-success", paused: "text-warning", draft: "text-base-content/50",
};

export function StatusDot({ status }: { status: string | null | undefined }) {
  const s = status ?? "new";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium capitalize ${STATUS[s] ?? "text-base-content/60"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{s}
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
