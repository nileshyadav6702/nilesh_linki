import { useRef, useState, type ReactNode } from "react";
import { flamesFor } from "@/lib/signals/scoring";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { RiAtLine, RiFireFill, RiHeartPulseLine, RiLoader4Line, RiPhoneLine, RiSparkling2Line } from "react-icons/ri";
import { signalLine } from "@/components/agents/signal-line";
import type { ContactRow } from "@/components/contacts/useContacts";
import { failToast } from "@/components/settings/billing/credits-toast";

/** Cells for the Contacts table: AI score with an explanation card, copyable email / phone, approval. */

const BANDS = [
  { min: 70, label: "Hot", text: "High-priority lead: strong fit and intent", tint: "bg-[#fdeee6] text-[#d4572a]" },
  { min: 50, label: "Warm", text: "Good fit showing interest; worth a timely touch", tint: "bg-[#fdf3e4] text-[#c27a1e]" },
  { min: 0, label: "Cool", text: "Early interest or a looser fit; nurture before pitching", tint: "bg-base-200 text-base-content/60" },
];
const bandOf = (score: number) => BANDS.find((b) => score >= b.min)!;

function Flame({ on, size = 20 }: { on: boolean; size?: number }) {
  return <RiFireFill size={size} className={on ? "text-[#ef6c3a]" : "text-base-content/15"} aria-hidden="true" />;
}

export function Flames({ score, size = 20 }: { score: number; size?: number }) {
  const n = flamesFor(score);
  return <span className="inline-flex gap-0.5">{[1, 2, 3].map((i) => <Flame key={i} on={i <= n} size={size} />)}</span>;
}

/** Flames, with a card on hover explaining the score (rendered in a portal so the table can't clip it). */
export function ScoreCell({ row }: { row: ContactRow }) {
  // Unscored contacts carry intent_score 0: show no flames for them.
  const score = row.lead_score ?? (row.intent_score ? row.intent_score : null);
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  if (score === null || score === undefined) return <span className="text-[13px] text-base-content/30">—</span>;
  const band = bandOf(score);
  const s = row.signals[0];
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ x: Math.min(window.innerWidth - 410, Math.max(10, r.left + r.width / 2 - 200)), y: r.top, below: r.top < 300 });
  };
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)} tabIndex={0} className="inline-flex cursor-help rounded-[6px] p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" aria-label={`${band.label} lead, score ${Math.round(score)}`}>
      <Flames score={score} />
      {at && createPortal(
        <div role="tooltip" style={{ left: at.x, top: at.below ? at.y + 34 : undefined, bottom: at.below ? undefined : window.innerHeight - at.y + 8 }}
          className="wizard-rise pointer-events-none fixed z-[80] w-[400px] overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
          <div className="flex items-start gap-3 px-5 pt-4">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${band.tint}`}><RiFireFill size={20} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><span className="text-[17px] font-medium">{band.label}</span><span className="rounded-full bg-base-200 px-2 py-0.5 text-[12px] tabular-nums text-base-content/60">{Math.round(score)}/100</span></div>
              <div className="text-[14px] text-base-content/60">{band.text}</div>
            </div>
          </div>
          <div className="flex justify-center py-3"><Flames score={score} size={30} /></div>
          <div className="space-y-2.5 border-t border-[var(--border-subtle)] bg-base-200/30 px-5 py-3.5 text-[14px] leading-snug text-base-content/80">
            {row.fit_reason && <div className="flex gap-2.5"><RiSparkling2Line size={16} className="mt-0.5 shrink-0 text-primary" />{row.fit_reason}</div>}
            {s && <div className="flex gap-2.5"><RiHeartPulseLine size={16} className="mt-0.5 shrink-0 text-[#d4572a]" />{[signalLine(s).lead, signalLine(s).link, signalLine(s).tail].filter(Boolean).join("")}</div>}
            {!row.fit_reason && !s && <div className="text-base-content/50">Scored from the profile alone; no signal yet.</div>}
          </div>
        </div>, document.body)}
    </span>
  );
}

const pill = "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] transition-colors";

/** Green "@" when there's an email (click copies it); grey otherwise, hover reveals Enrich. */
export function EmailCell({ row, onFound }: { row: ContactRow; onFound: () => void }) {
  const [busy, setBusy] = useState(false);
  if (row.email) {
    return (
      <button type="button" title={row.email_unsubscribed ? `${row.email} (unsubscribed)` : "Click to copy"} onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(row.email!); toast.success(`Copied ${row.email}`); }}
        className={`${pill} ${row.email_unsubscribed ? "bg-error/10 text-error" : "bg-success/15 text-[#2f7a43] hover:bg-success/25"}`} aria-label={`Copy email ${row.email}`}>
        <RiAtLine size={16} />
      </button>
    );
  }
  async function enrich(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "find_email" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { failToast(d, "Could not look up the email"); return; }
      if (d.found) { toast.success("Email found"); onFound(); } else toast.message("No email found for this contact");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not look up the email"); }
    finally { setBusy(false); }
  }
  return (
    <button type="button" onClick={enrich} disabled={busy} title="Find email" className={`group/e ${pill} bg-base-200 text-base-content/55 hover:bg-[#e8e6fb] hover:text-[#4f46e5]`}>
      {busy ? <RiLoader4Line size={16} className="animate-spin" /> : <RiAtLine size={16} />}<span className="hidden group-hover/e:inline">Enrich</span>
    </button>
  );
}

export function PhoneCell({ row }: { row: ContactRow }) {
  if (row.phone) {
    return (
      <button type="button" title="Click to copy" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(row.phone!); toast.success(`Copied ${row.phone}`); }}
        className={`${pill} bg-success/15 text-[#2f7a43] hover:bg-success/25`} aria-label={`Copy phone ${row.phone}`}><RiPhoneLine size={16} /></button>
    );
  }
  return (
    <button type="button" title="Phone enrichment is coming soon" onClick={(e) => { e.stopPropagation(); toast.message("Phone enrichment is coming soon"); }}
      className={`group/p ${pill} bg-base-200 text-base-content/55 hover:bg-[#e8e6fb] hover:text-[#4f46e5]`}>
      <RiPhoneLine size={16} /><span className="hidden group-hover/p:inline">Enrich</span>
    </button>
  );
}

const btn = "inline-flex h-8 items-center rounded-[6px] px-3 text-[13px] font-medium transition-colors disabled:opacity-60";

/** Approve / Reject for agent leads awaiting a decision; a status pill once decided; nothing for list-only contacts. */
export function ApprovalCell({ row, onDecide }: { row: ContactRow; onDecide: (id: string, decision: "approve" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const s = row.agent_status ?? "";
  if (!row.agent_id || !s) return <span className="text-[13px] text-base-content/30">—</span>;
  const go = async (d: "approve" | "reject", e: React.MouseEvent) => { e.stopPropagation(); setBusy(d); try { await onDecide(row.id, d); } finally { setBusy(null); } };
  const decided: ReactNode =
    s === "approved" || s === "enrolled" ? <span className="rounded-full bg-success/15 px-3 py-1 text-[13px] text-[#2f7a43]">Approved</span>
    : s === "skipped" ? <span className="rounded-full bg-base-200 px-3 py-1 text-[13px] text-base-content/55">Rejected</span>
    : s === "disqualified" ? <span className="rounded-full bg-base-200 px-3 py-1 text-[13px] text-base-content/55">Not a fit</span>
    : null;
  const canApprove = ["drafted", "qualified"].includes(s);
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {decided}
      {canApprove && <button type="button" disabled={!!busy} onClick={(e) => void go("approve", e)} className={`${btn} bg-[#5cc28a] text-white hover:bg-[#4caf7a]`}>{busy === "approve" ? <RiLoader4Line size={14} className="animate-spin" /> : "Approve"}</button>}
      {!["skipped", "disqualified"].includes(s) && <button type="button" disabled={!!busy} onClick={(e) => void go("reject", e)} className={`${btn} border border-[var(--border-subtle)] bg-base-100 text-base-content/75 hover:border-error/40 hover:text-error`}>{busy === "reject" ? <RiLoader4Line size={14} className="animate-spin" /> : "Reject"}</button>}
      {!decided && !canApprove && s === "new" && <span className="text-[13px] text-base-content/45">Scoring…</span>}
    </div>
  );
}
