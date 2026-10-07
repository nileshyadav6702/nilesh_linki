import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiExternalLinkLine, RiLoader4Line, RiSparkling2Line } from "react-icons/ri";
import { Card, Flames, ghostBtn, secondaryBtn, SignalChip } from "@/components/agents/ui";

interface PreviewLead {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; location: string | null; linkedin_url: string | null;
  lead_score: number | null; fit_verdict: string | null; fit_reason: string | null; industry: string | null; employee_count: number | null; signal_title: string | null; signal_type: string | null;
}

interface Summary { found: number; not_a_fit: number; filtered: number; reasons: string[] }

const LINKEDIN_NOTE: Record<string, string> = {
  no_account: "LinkedIn signals will run once a LinkedIn account is connected and selected in the next step.",
  paused: "LinkedIn discovery is paused for this account after LinkedIn pushed back; it resumes automatically.",
};

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
      <Card className="mx-auto max-w-2xl py-12 text-center">
        <RiLoader4Line size={28} className="mx-auto animate-spin text-warning" />
        <h2 className="mt-4 text-xl font-semibold">Finding your first leads</h2>
        <p className="mt-1 text-sm text-base-content/55">Searching for leads matching your source, ICP and signals. This can take up to two minutes.</p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-[-.02em]">Preview your first {leads.length || ""} leads</h2>
        <p className="mt-1 text-sm text-base-content/55">Reject any lead that doesn&apos;t fit your ICP; the next best match takes its place.</p>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning"><RiSparkling2Line size={16} className="mt-0.5 shrink-0" />Nothing is sent from here. These leads are scored and wait for outreach to be switched on.</p>
      {note && <p className="text-xs text-base-content/50">{note}</p>}
      {summary && summary.found > 0 && (
        <p className="text-xs text-base-content/55">
          Found {summary.found} {summary.found === 1 ? "person" : "people"} engaging with your signals
          {summary.not_a_fit > 0 ? ` · ${summary.not_a_fit} didn't match your ICP` : ""}
          {summary.filtered > 0 ? ` · ${summary.filtered} filtered out (competitors' staff, excluded titles)` : ""}.
        </p>
      )}
      {leads.length === 0 ? (
        <Card className="space-y-3 text-sm text-base-content/60">
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
          <div><button className={secondaryBtn} onClick={run}>Search again</button></div>
        </Card>
      ) : leads.map((l) => (
        <Card key={l.id} className="!py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{l.full_name ?? "Unknown"}</span>
                {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-base-content/40 hover:text-base-content" aria-label="LinkedIn"><RiExternalLinkLine size={14} /></a>}
                <Flames score={l.lead_score} />
              </div>
              <div className="text-sm text-base-content/60">{[l.title ?? l.headline, l.company].filter(Boolean).join(" · ")}</div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {[l.industry, l.employee_count ? `${l.employee_count} employees` : null, l.location].filter(Boolean).map((x) => <span key={String(x)} className="rounded-md bg-base-200 px-2 py-0.5">{x}</span>)}
                {l.signal_type && <SignalChip type={l.signal_type} />}
              </div>
              {l.signal_title && <div className="text-xs text-base-content/55">{l.signal_title}</div>}
              {l.fit_reason && <div className="text-xs text-base-content/45">{l.fit_reason}</div>}
            </div>
            <button className={ghostBtn} onClick={() => reject(l.id)}><RiCloseLine size={14} /> Reject</button>
          </div>
        </Card>
      ))}
    </div>
  );
}
