import { RiArrowRightLine, RiAtLine, RiMailForbidLine, RiPhoneLine } from "react-icons/ri";
import { signalLine } from "@/components/agents/signal-line";
import { Pill, SIGNAL_LABEL } from "@/components/agents/ui";
import type { LeadRowData, Outreach } from "./types";

const muted = "inline-flex h-7 w-7 items-center justify-center rounded-full bg-base-200 text-base-content/35";

function host(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.slice(0, 60); } catch { return null; }
}

export function SignalCell({ lead }: { lead: LeadRowData }) {
  const s = lead.signals[0];
  if (!s) return <span className="text-[13.5px] text-base-content/30">—</span>;
  const line = signalLine(s);
  const more = (lead.signal_count ?? lead.signals.length) - 1;
  const sub = line.sub ?? (s.snippet ? `"${s.snippet}"` : null) ?? host(s.source_url) ?? SIGNAL_LABEL[s.type] ?? s.type;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[14.5px] text-base-content/80">
          {line.lead}
          {line.link && (line.href
            ? <a href={line.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary underline underline-offset-2 hover:opacity-80">{line.link}</a>
            : <span className="text-primary">{line.link}</span>)}
          {line.tail}
        </span>
        {more > 0 && <Pill className="shrink-0">+{more} signal{more > 1 ? "s" : ""}</Pill>}
      </div>
      <div className="truncate text-[13.5px] text-base-content/45">{sub}</div>
    </div>
  );
}

export function EmailCell({ lead }: { lead: LeadRowData }) {
  if (!lead.email) return <span className={muted} title="No email yet"><RiMailForbidLine size={14} /></span>;
  return (
    <span title={lead.email_unsubscribed ? "Unsubscribed" : lead.email}>
      <Pill tone={lead.email_unsubscribed ? "error" : "success"} className="max-w-full"><RiAtLine size={13} className="shrink-0" /><span className="truncate">{lead.email}</span></Pill>
    </span>
  );
}

export function PhoneCell({ lead }: { lead: LeadRowData }) {
  if (!lead.phone) return <span className={muted} title="No phone yet"><RiPhoneLine size={14} /></span>;
  return <Pill tone="ink" className="max-w-full"><RiPhoneLine size={13} className="shrink-0" /><span className="truncate">{lead.phone}</span></Pill>;
}

function localTime(iso: string): string {
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Invitation · Completed — Step 1 → Message · Next — Step 2 · Waiting for …" (prev → next). */
export function OutreachCell({ outreach }: { outreach: Outreach | null }) {
  if (!outreach || (!outreach.prev && !outreach.next)) return <span className="whitespace-nowrap text-[14.5px] text-base-content/45">Not contacted yet</span>;
  const { prev, next } = outreach;
  const waiting = outreach.waiting && outreach.next_at && outreach.waiting.startsWith("Waiting until") ? `Waiting until ${localTime(outreach.next_at)}` : outreach.waiting;
  const ended = !next && outreach.state !== "in_progress" && outreach.state !== "pending";
  return (
    <div className="flex items-start gap-2.5 text-[14.5px] leading-snug">
      {prev && (
        <div className="min-w-0 max-w-[140px]">
          <div className="font-medium text-base-content/85">{prev.label}{prev.accepted && <span className="font-normal text-[#3a8c4f]"> (Accepted)</span>}</div>
          <div className="text-base-content/45">Completed — Step {prev.order}</div>
        </div>
      )}
      {prev && (next || ended) && <RiArrowRightLine size={14} className="mt-0.5 shrink-0 text-base-content/35" aria-hidden="true" />}
      {next ? (
        <div className="min-w-0 max-w-[220px]">
          <div className="font-medium text-base-content/85">{next.label}</div>
          <div className="text-base-content/45">Next — Step {next.order}</div>
          {waiting && <div className="text-[#b8742a]">{waiting}</div>}
        </div>
      ) : ended && (
        <div className="text-base-content/45">{outreach.state === "completed" ? "Sequence finished" : outreach.state === "failed" ? "Stopped (error)" : "Stopped"}</div>
      )}
    </div>
  );
}

const reviewBtn = "inline-flex h-7 items-center rounded-[6px] border border-[var(--border-subtle)] bg-base-100 px-2.5 text-[13.5px] font-medium transition-colors";

export function ApprovalCell({ lead, onReject, onReview }: { lead: LeadRowData; onReject: () => void; onReview: () => void }) {
  const s = lead.agent_status ?? "";
  const pill =
    s === "approved" || s === "enrolled" ? <Pill tone="success">Approved</Pill>
    : s === "drafted" ? <Pill tone="amber">To review</Pill>
    : s === "skipped" ? <Pill tone="ink">Rejected</Pill>
    : s === "disqualified" ? <Pill tone="ink">Not a fit</Pill>
    : s === "needs_data" ? <span title="Missing headline and about — scored once the profile is enriched"><Pill tone="amber">Needs profile data</Pill></span>
    : s === "qualified" ? <Pill tone="teal">Qualified</Pill>
    : s === "new" ? <Pill tone="ink">Scoring</Pill>
    : <span className="text-[13.5px] text-base-content/35">—</span>;
  return (
    <div className="flex items-center gap-2">
      {pill}
      {s === "drafted" && <button type="button" className={`${reviewBtn} text-primary hover:border-primary/40`} onClick={onReview}>Review</button>}
      {s && !["skipped", "disqualified"].includes(s) && (
        <button type="button" className={`${reviewBtn} text-base-content/70 hover:border-error/40 hover:text-error`} onClick={onReject}>Reject</button>
      )}
    </div>
  );
}
