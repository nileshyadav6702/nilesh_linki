import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiBuilding2Line, RiCloseLine, RiGroupLine, RiLinkedinBoxFill, RiLoader4Line, RiMap2Line, RiRefreshLine, RiSparkling2Line } from "react-icons/ri";
import { Avatar, secondaryBtn } from "@/components/agents/ui";
import { StepHeading, StepSheet } from "@/components/agents/wizard/kit";

interface PreviewLead {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; location: string | null; linkedin_url: string | null;
  lead_score: number | null; fit_verdict: string | null; fit_reason: string | null; industry: string | null; employee_count: number | null; signal_title: string | null; signal_type: string | null;
  profile_image_url?: string | null;
}

interface Summary { found: number; not_a_fit: number; filtered: number; reasons: string[] }

const LINKEDIN_NOTE: Record<string, string> = {
  no_account: "LinkedIn signals will run once a LinkedIn account is connected and selected in the next step.",
  paused: "LinkedIn discovery is paused for this account after LinkedIn pushed back; it resumes automatically.",
};

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-primary/[0.07] px-2.5 py-1 text-[15px] text-base-content/80"><span className="text-base-content/70">{icon}</span>{children}</span>;
}

/** Finds the first leads now; rejecting one swaps in the next best and records why. */
export default function PreviewStep({ agentId, onBusy }: { agentId: string; onBusy?: (busy: boolean) => void }) {
  const [leads, setLeads] = useState<PreviewLead[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const started = useRef<string | null>(null);
  const busyCb = useRef(onBusy);
  useEffect(() => { busyCb.current = onBusy; });

  async function run() {
    setRunning(true);
    busyCb.current?.(true);
    setLeads(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/preview`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setLeads(d.leads ?? []);
      setSummary(d.summary ?? null);
      setNote([LINKEDIN_NOTE[d.linkedin as string], ...(d.errors ?? [])].filter(Boolean).join(" · ") || null);
      if (!r.ok) toast.error(d.error ?? "Preview failed");
    } catch {
      setLeads([]);
      toast.error("Preview failed");
    } finally { setRunning(false); busyCb.current?.(false); }
  }
  useEffect(() => {
    if (started.current === agentId) return;
    started.current = agentId;
    // Fetch-on-mount: the preview is an external search, not derived state.
    void (async () => { await run(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function reject(id: string) {
    setSaving(true);
    try {
      const r = await fetch(`/api/agents/${agentId}/preview`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: id, reason: reason.trim() }) });
      const d = await r.json();
      if (!r.ok) return toast.error(d.error ?? "Could not reject this lead");
      setLeads(d.leads);
      setRejecting(null); setReason("");
    } finally { setSaving(false); }
  }

  if (running || leads === null) {
    return (
      <StepSheet className="!py-16 text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-[14px] bg-primary/10 text-primary"><RiLoader4Line size={34} className="animate-spin" /></span>
        <StepHeading title="Finding your first leads" subtitle="We are searching for the first 5 leads matching your source, ICP, and signal setup." />
      </StepSheet>
    );
  }

  return (
    <StepSheet>
      <StepHeading title={`Preview your first ${leads.length || ""} leads`} subtitle="Reject any lead that does not fit your ICP. We will regenerate a fresh match for each one based on your feedback." />
      <div className="mx-auto flex max-w-[860px] items-start gap-4 rounded-[12px] bg-primary/10 px-6 py-4 text-[17px] leading-relaxed text-primary">
        <RiSparkling2Line size={20} className="mt-1 shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">Your feedback shapes your ICP.</span> <span className="opacity-90">Each rejection is replaced by a new lead better matching your criteria.</span></p>
      </div>
      {note && <p className="text-center text-[13.5px] text-base-content/50">{note}</p>}

      {leads.length === 0 ? (
        <div className="mx-auto max-w-[860px] space-y-3 rounded-[16px] border border-[var(--border-subtle)] p-6 text-[15px] text-base-content/60">
          {summary && summary.not_a_fit > 0 ? (
            <>
              <p className="font-medium text-base-content">The people engaging with your signals don&apos;t match your ICP yet.</p>
              {summary.reasons.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-base-content/55">{summary.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <p className="text-[13.5px]">Go back to <b>Sources</b> and track topics your buyers post about, or loosen <b>Target</b>.</p>
            </>
          ) : summary && summary.found === 0 ? (
            <p>No one engaged with your signals in the last week yet. Try broader topics or add competitor pages. Your agent keeps searching after launch.</p>
          ) : (
            <p>No leads yet. Sources may need a LinkedIn account, or signals have little activity right now. Your agent keeps searching after launch.</p>
          )}
          <div><button className={secondaryBtn} onClick={run}><RiRefreshLine size={16} /> Search again</button></div>
        </div>
      ) : (
        <ul className="space-y-4">
          {leads.map((l, i) => (
            <li key={l.id} className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-5 py-5" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start gap-4">
                <Avatar name={l.full_name} src={l.profile_image_url} size={52} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[17px] font-medium">{l.full_name ?? "Unknown"}</span>
                      {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:opacity-80" aria-label={`${l.full_name ?? "Lead"} on LinkedIn`}><RiLinkedinBoxFill size={22} /></a>}
                    </div>
                    <div className="mt-1 text-[15px] text-base-content/60">{[l.title ?? l.headline, l.company].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {l.industry && <Chip icon={<RiBuilding2Line size={16} />}>{l.industry}</Chip>}
                    {l.employee_count ? <Chip icon={<RiGroupLine size={16} />}>{l.employee_count.toLocaleString()} employees</Chip> : null}
                    {l.location && <Chip icon={<RiMap2Line size={16} />}>{l.location}</Chip>}
                  </div>
                  {rejecting === l.id && (
                    <form className="wizard-rise flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void reject(l.id); }}>
                      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why isn't this a fit? (optional, it tunes your agent)"
                        className="h-10 min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] px-3 text-[15px] outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]" />
                      <button type="submit" disabled={saving} className="h-10 rounded-[8px] bg-primary px-4 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60">{saving ? "Replacing…" : "Reject & replace"}</button>
                      <button type="button" onClick={() => { setRejecting(null); setReason(""); }} className="h-10 rounded-[8px] px-3 text-[15px] text-base-content/70 hover:bg-base-200">Cancel</button>
                    </form>
                  )}
                </div>
                {rejecting !== l.id && (
                  <button type="button" onClick={() => { setRejecting(l.id); setReason(""); }} className="inline-flex shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[15px] text-base-content hover:bg-base-200">
                    <RiCloseLine size={20} /> Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </StepSheet>
  );
}
