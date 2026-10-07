import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiCloseLine, RiExternalLinkLine, RiMailLine } from "react-icons/ri";
import { ghostBtn, primaryBtn, ScoreBadge, secondaryBtn, SignalChip, StatusDot, textareaCls, inputCls, timeAgo } from "@/components/agents/ui";

export interface LeadSignal { id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string }
export interface LeadDraft { id: string; channel: string; subject: string | null; body: string; auto_approve_at: string | null }
export interface Lead {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; location: string | null;
  linkedin_url: string | null; email: string | null; fit_score: number | null; fit_verdict: string | null; fit_reason: string | null; fit_confidence: string | null;
  intent_score: number; lead_score: number | null; agent_status: string | null; agent_name: string | null; skip_reason: string | null;
  signals: LeadSignal[]; drafts: LeadDraft[];
}

function DraftEditor({ draft, onDone }: { draft: LeadDraft; onDone: () => void }) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const r = await fetch(`/api/approvals/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, subject: draft.channel === "email" ? subject : undefined, body }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(d.error ?? "Failed");
    toast.success(decision === "approve" ? (d.enrolled ? "Approved — lead added to the campaign" : `Approved${d.reason ? ` (${d.reason})` : ""}`) : "Draft rejected");
    onDone();
  }
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between text-xs text-base-content/50">
        <span className="font-medium">{draft.channel === "email" ? "Email" : "LinkedIn message"}</span>
        {draft.auto_approve_at && <span>Auto-sends {new Date(draft.auto_approve_at).toLocaleString()}</span>}
      </div>
      {draft.channel === "email" && <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
      <textarea className={textareaCls} rows={6} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={busy} onClick={() => decide("approve")}><RiCheckLine size={16} /> Approve</button>
        <button className={secondaryBtn} disabled={busy} onClick={() => decide("reject")}><RiCloseLine size={16} /> Reject</button>
      </div>
    </div>
  );
}

/** "Why this lead": signals with evidence, fit reasoning, score breakdown and the drafted first touch. */
export default function LeadPanel({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  async function act(action: string, reason?: string) {
    const r = await fetch(`/api/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const d = await r.json();
    if (!r.ok) return toast.error(d.error ?? "Failed");
    if (action === "find_email") toast[d.found ? "success" : "message"](d.found ? `Found ${d.email} via ${d.provider}` : "No email found");
    else toast.success(action === "skip" ? "Lead skipped" : action === "enroll" ? "Lead added to the campaign" : "Lead will be re-scored");
    onChange();
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/contacts/${lead.id}`} className="text-lg font-semibold hover:underline">{lead.full_name ?? "Unknown"}</Link>
          {lead.linkedin_url && <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className={ghostBtn} aria-label="Open LinkedIn profile"><RiExternalLinkLine size={14} /></a>}
        </div>
        <p className="text-sm text-base-content/60">{lead.headline ?? [lead.title, lead.company].filter(Boolean).join(" at ")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-base-content/50">
          <StatusDot status={lead.agent_status} />{lead.agent_name && <span>{lead.agent_name}</span>}{lead.location && <span>{lead.location}</span>}
          {lead.email ? <span className="inline-flex items-center gap-1"><RiMailLine size={12} />{lead.email}</span> : <button className="underline" onClick={() => act("find_email")}>Find email</button>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-base-200 p-2.5"><div className="text-lg font-semibold tabular-nums">{lead.lead_score === null ? "—" : Math.round(lead.lead_score)}</div><div className="text-[11px] text-base-content/50">Lead score</div></div>
        <div className="rounded-xl bg-base-200 p-2.5"><div className="text-lg font-semibold tabular-nums">{lead.fit_score === null ? "—" : Math.round(lead.fit_score)}</div><div className="text-[11px] text-base-content/50">ICP fit</div></div>
        <div className="rounded-xl bg-base-200 p-2.5"><div className="text-lg font-semibold tabular-nums">{Math.round(lead.intent_score)}</div><div className="text-[11px] text-base-content/50">Intent</div></div>
      </div>

      {lead.fit_reason && (
        <div className="space-y-1">
          <div className="flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">Fit</h3><ScoreBadge score={lead.fit_score} verdict={lead.fit_verdict} />{lead.fit_confidence === "low" && <span className="text-[11px] text-warning">low confidence</span>}</div>
          <p className="text-sm text-base-content/70">{lead.fit_reason}</p>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">Why now</h3>
        {lead.signals.length === 0 && <p className="text-sm text-base-content/45">No signals recorded.</p>}
        {lead.signals.map((s) => (
          <div key={s.id} className="rounded-xl border border-[var(--border-subtle)] p-3">
            <div className="flex items-center justify-between gap-2"><SignalChip type={s.type} /><span className="text-[11px] text-base-content/40">{timeAgo(s.occurred_at)}</span></div>
            <p className="mt-1.5 text-sm font-medium">{s.title}</p>
            {s.snippet && <p className="mt-1 text-sm text-base-content/60 line-clamp-3">{s.snippet}</p>}
            {s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-base-content/50 underline">Source <RiExternalLinkLine size={11} /></a>}
          </div>
        ))}
      </div>

      {lead.drafts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">First touch</h3>
          {lead.drafts.map((d) => <DraftEditor key={d.id} draft={d} onDone={onChange} />)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-4">
        {(lead.agent_status === "approved" || lead.agent_status === "qualified") && !lead.drafts.length && <button className={primaryBtn} onClick={() => act("enroll")}>Add to campaign</button>}
        {lead.agent_status !== "skipped" && lead.agent_status !== "enrolled" && <button className={secondaryBtn} onClick={() => { const reason = prompt("Why skip? (helps tune the agent)") ?? undefined; act("skip", reason); }}>Skip lead</button>}
        {(lead.agent_status === "disqualified" || lead.agent_status === "skipped") && <button className={secondaryBtn} onClick={() => act("requalify")}>Re-score</button>}
      </div>
    </div>
  );
}
