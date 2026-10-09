import { RiFocus2Line } from "react-icons/ri";
import { flamesFor } from "@/lib/signals/scoring";
import { signalLine } from "@/components/agents/signal-line";
import { Flames, Pill, SIGNAL_LABEL, timeAgo } from "@/components/agents/ui";
import { HoverCard } from "./HoverCard";
import type { LeadRowData, LeadSignal } from "./types";

/** Cool / Warm / Hot, with the one-line reading shown under the score. */
export const SCORE_TIERS = {
  1: { label: "Cool", line: "Relevant fit — no strong buying signal yet", color: "#6b7280" },
  2: { label: "Warm", line: "Promising lead — showing interesting signals", color: "#e8590c" },
  3: { label: "Hot", line: "Top priority — strong fit and fresh intent", color: "#d9381e" },
} as const;

const PARTS = [
  { key: "fit", label: "ICP fit", weight: 40 },
  { key: "signal", label: "Signal strength", weight: 30 },
  { key: "recency", label: "Recency", weight: 20 },
  { key: "relevance", label: "Relevance", weight: 10 },
] as const;

type Breakdown = Partial<Record<(typeof PARTS)[number]["key"], number>>;

function breakdownOf(raw: string | null | undefined): Breakdown | null {
  if (!raw) return null;
  try { const b = JSON.parse(raw) as Breakdown; return typeof b.fit === "number" ? b : null; } catch { return null; }
}

/** The signal that counts most: heaviest type first, then the newest. */
export function strongestSignal(signals: LeadSignal[]): LeadSignal | null {
  return [...signals].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || b.occurred_at.localeCompare(a.occurred_at))[0] ?? null;
}

export const signalName = (s: LeadSignal) => {
  const sub = signalLine(s).sub;
  return s.type === "funding" ? s.title : sub ?? SIGNAL_LABEL[s.type] ?? s.title;
};

/** ICP fit 40 · signal 30 · recency 20 · relevance 10, as bars. Nothing for leads scored before v2. */
export function ScoreBreakdown({ raw, color, className = "" }: { raw: string | null | undefined; color: string; className?: string }) {
  const parts = breakdownOf(raw);
  if (!parts) return null;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {PARTS.map((p) => {
        const v = Math.round(parts[p.key] ?? 0);
        return (
          <div key={p.key} className="flex items-center gap-2.5 text-[13px]">
            <span className="w-[130px] shrink-0 text-base-content/60">{p.label} <span className="text-base-content/35">{p.weight}%</span></span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-200"><span className="block h-full rounded-full" style={{ width: `${v}%`, background: color }} /></span>
            <span className="w-7 text-right tabular-nums text-base-content/55">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreCell({ lead }: { lead: LeadRowData }) {
  const score = lead.lead_score ?? lead.intent_score;
  if (score === null || score === undefined) return <Flames score={null} />;
  const tier = SCORE_TIERS[flamesFor(score)];
  const top = strongestSignal(lead.signals);
  return (
    <HoverCard label={`Lead score ${Math.round(score)}: ${tier.label}`} trigger={<Flames score={score} />} card={
      <div className="space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[17px] font-semibold" style={{ color: tier.color }}>{tier.label}</div>
            <div className="text-[14px] text-base-content/60">{tier.line}</div>
          </div>
          <div className="flex flex-col items-end gap-1"><Flames score={score} /><span className="text-[12.5px] tabular-nums text-base-content/45">{Math.round(score)} / 100</span></div>
        </div>
        {lead.fit_reason && (
          <div>
            <div className="text-[12.5px] font-medium uppercase tracking-wide text-base-content/40">Why it fits</div>
            <p className="mt-1 text-[14.5px] leading-snug text-base-content/80">{lead.fit_reason}</p>
          </div>
        )}
        {top && (
          <div>
            <div className="text-[12.5px] font-medium uppercase tracking-wide text-base-content/40">Strongest signal</div>
            <div className="mt-1 flex items-center gap-2 text-[14.5px] text-base-content/80"><RiFocus2Line size={15} className="shrink-0 text-primary" /><span className="truncate">{signalName(top)}</span></div>
          </div>
        )}
        <ScoreBreakdown raw={lead.score_breakdown} color={tier.color} className="border-t border-[var(--border-subtle)] pt-3" />
      </div>
    } />
  );
}

/** "+N signals": hover to see every signal on the lead, newest first. */
export function MoreSignals({ lead, more }: { lead: LeadRowData; more: number }) {
  const total = lead.signal_count ?? lead.signals.length;
  return (
    <HoverCard label={`${total} signals`} width={360} trigger={<Pill className="shrink-0 hover:bg-base-300">+{more} signal{more > 1 ? "s" : ""}</Pill>} card={
      <div>
        <div className="mb-2.5 text-[14px] font-semibold text-base-content">{total} signal{total === 1 ? "" : "s"}</div>
        <ul className="space-y-2.5">
          {lead.signals.map((s) => {
            const line = signalLine(s);
            return (
              <li key={s.id} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/70" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] leading-snug text-base-content/85">
                    {line.lead}{line.link && (line.href ? <a href={line.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{line.link}</a> : <span className="text-primary">{line.link}</span>)}{line.tail}
                  </div>
                  {line.sub && <div className="truncate text-[13px] text-base-content/50">{line.sub}</div>}
                </div>
                <span className="shrink-0 text-[12px] text-base-content/35">{timeAgo(s.occurred_at)}</span>
              </li>
            );
          })}
        </ul>
        {total > lead.signals.length && <div className="mt-2.5 text-[12.5px] text-base-content/45">+{total - lead.signals.length} more in the lead panel</div>}
      </div>
    } />
  );
}
