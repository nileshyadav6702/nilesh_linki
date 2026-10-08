import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiBuilding2Line, RiCloseLine, RiLinkedinBoxFill, RiLoader4Line, RiMapPinLine, RiRefreshLine, RiSparkling2Line, RiTeamLine } from "react-icons/ri";
import { Avatar, Callout, Flames, ghostBtn, Panel, secondaryBtn, SignalChip } from "@/components/agents/ui";
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
  return <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-base-200 px-2.5 py-1 text-[13px] text-base-content/75"><span className="text-base-content/45">{icon}</span>{children}</span>;
}

/** Finds the first leads now; rejecting one swaps in the next best and records why. */
export default function PreviewStep({ agentId }: { agentId: string }) {
  const [leads, setLeads] = useState<PreviewLead[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef<string | null>(null);

  async function run() {
    setRunning(true);
    setLeads(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/preview`, { method: "POST" });
      const d = await r.json();
      setLeads(d.leads ?? []);
      setSummary(d.summary ?? null);
      setNote([LINKEDIN_NOTE[d.linkedin as string], ...(d.errors ?? [])].filter(Boolean).join(" · ") || null);
      if (!r.ok) toast.error(d.error ?? "Preview failed");
    } finally { setRunning(false); }
  }
  useEffect(() => {
    if (started.current === agentId) return;
    started.current = agentId;
    // Fetch-on-mount: the preview is an external search, not derived state.
    void (async () => { await run(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function reject(id: string) {
    const reason = window.prompt("Why isn't this a fit? (optional — it tunes your agent)") ?? "";
    const r = await fetch(`/api/agents/${agentId}/preview`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: id, reason }) });
    const d = await r.json();
    if (!r.ok) return toast.error(d.error ?? "Failed");
    setLeads(d.leads);
  }

  if (running || leads === null) {
    return (
      <StepSheet className="max-w-2xl text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><RiLoader4Line size={26} className="animate-spin" /></span>
        <StepHeading title="Finding your first leads" subtitle="Searching for leads matching your source, ICP and signals. This can take up to two minutes." />
      </StepSheet>
    );
  }

  return (
    <StepSheet>
      <StepHeading title={`Preview your first ${leads.length || ""} leads`} subtitle="Reject any lead that doesn't fit your ICP; the next best match takes its place." />
      <Callout icon={<RiSparkling2Line size={16} />} title="Nothing is sent from here.">These leads are scored and wait for outreach to be switched on.</Callout>
      {note && <p className="text-xs text-base-content/50">{note}</p>}
      {summary && summary.found > 0 && (
        <p className="text-xs text-base-content/55">
          Found {summary.found} {summary.found === 1 ? "person" : "people"} engaging with your signals
          {summary.not_a_fit > 0 ? ` · ${summary.not_a_fit} didn't match your ICP` : ""}
          {summary.filtered > 0 ? ` · ${summary.filtered} filtered out (competitors' staff, excluded titles)` : ""}.
        </p>
      )}
      {leads.length === 0 ? (
        <Panel className="space-y-3 p-5 text-sm text-base-content/60">
          {summary && summary.not_a_fit > 0 ? (
            <>
              <p className="font-medium text-base-content">The people engaging with your signals don&apos;t match your ICP yet.</p>
              {summary.reasons.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-base-content/55">{summary.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              <p className="text-xs">Go back to <b>Sources</b> and track topics your buyers post about (use &ldquo;Generate with AI&rdquo; for keywords from your ICP), or loosen <b>Target</b>.</p>
            </>
          ) : summary && summary.found === 0 ? (
            <p>No one engaged with your signals in the last week yet — try broader topics or add competitor pages. Your agent keeps searching after launch.</p>
          ) : (
            <p>No leads yet — sources may need a LinkedIn account, or signals have little activity right now. Your agent keeps searching after launch.</p>
          )}
          <div><button className={secondaryBtn} onClick={run}><RiRefreshLine size={16} /> Search again</button></div>
        </Panel>
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <Panel key={l.id} className="px-5 py-4">
              <div className="flex items-start gap-4">
                <Avatar name={l.full_name} src={l.profile_image_url} size={48} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{l.full_name ?? "Unknown"}</span>
                    {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:opacity-80" aria-label="LinkedIn profile"><RiLinkedinBoxFill size={18} /></a>}
                    <Flames score={l.lead_score} />
                  </div>
                  <div className="-mt-1 text-sm text-base-content/60">{[l.title ?? l.headline, l.company].filter(Boolean).join(" · ")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {l.industry && <Chip icon={<RiBuilding2Line size={14} />}>{l.industry}</Chip>}
                    {l.employee_count ? <Chip icon={<RiTeamLine size={14} />}>{l.employee_count} employees</Chip> : null}
                    {l.location && <Chip icon={<RiMapPinLine size={14} />}>{l.location}</Chip>}
                    {l.signal_type && <SignalChip type={l.signal_type} />}
                  </div>
                  {l.signal_title && <div className="text-xs text-base-content/55">{l.signal_title}</div>}
                  {l.fit_reason && <div className="text-xs text-base-content/45">{l.fit_reason}</div>}
                </div>
                <button className={ghostBtn} onClick={() => reject(l.id)}><RiCloseLine size={15} /> Reject</button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </StepSheet>
  );
}
