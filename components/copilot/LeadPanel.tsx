import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RiArrowDownSLine, RiArrowRightDoubleLine, RiCheckLine, RiCloseLine, RiKey2Line, RiLinkedinBoxFill, RiLoader4Line, RiUpload2Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { Avatar, SIGNAL_LABEL } from "@/components/agents/ui";
import StepItem from "@/components/copilot/StepItem";
import type { DraftRow, LeadDetail } from "@/lib/agents/copilot";

/** Right pane of Copilot: who the lead is, why now, and the campaign they're about to receive. */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const Caps = ({ children }: { children: ReactNode }) => <div className="text-[15px] font-medium uppercase tracking-[0.02em] text-base-content/70">{children}</div>;
const Chip = ({ children }: { children: ReactNode }) => <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-primary/[0.06] px-3 py-1 text-[15px] text-base-content/85">{children}</span>;

function HotLead({ score }: { score: number | null }) {
  if (score === null) return null;
  const n = score >= 70 ? 3 : score >= 50 ? 2 : 1;
  const label = n === 3 ? "Hot lead" : n === 2 ? "Warm lead" : "Cool lead";
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" title={`Lead score ${Math.round(score)}`}>
      <span className="flex gap-1">{[1, 2, 3].map((i) => (
        <svg key={i} width="22" height="26" viewBox="0 0 12 14" aria-hidden="true"><path d="M6 0c.6 2.4 4.8 4.4 4.8 8.2A4.8 4.8 0 0 1 1.2 8.2C1.2 6 2.8 4.6 3.6 3.4c.3 1.5 1.1 2.3 2 2.6C5.4 4 5.4 2 6 0Z" fill="var(--color-primary, #e8590c)" opacity={i <= n ? 1 : 0.2} /></svg>
      ))}</span>
      <span className="text-[15px] text-base-content/65">{label}</span>
    </div>
  );
}

function ExportMenu({ detail }: { detail: LeadDetail }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const c = detail.contact;
  function csv() {
    const cols = ["full_name", "title", "company", "location", "email", "linkedin_url", "lead_score"];
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob([`${cols.join(",")}\n${cols.map((k) => cell(c[k])).join(",")}\n`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${String(c.full_name ?? "lead").replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  }
  async function copy() {
    const url = str(c.linkedin_url);
    if (!url) return toast.error("This lead has no LinkedIn URL");
    await navigator.clipboard.writeText(url).catch(() => {});
    toast.success("LinkedIn URL copied");
    setOpen(false);
  }
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-5 text-[17px] hover:bg-base-200">
        <RiUpload2Line size={19} /> Export <RiArrowDownSLine size={20} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="wizard-rise absolute bottom-full right-0 z-30 mb-2 w-52 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
          <button type="button" onClick={csv} className="block w-full px-4 py-2.5 text-left text-[15px] hover:bg-base-200">Download as CSV</button>
          <button type="button" onClick={() => void copy()} className="block w-full px-4 py-2.5 text-left text-[15px] hover:bg-base-200">Copy LinkedIn URL</button>
        </div>
      )}
    </div>
  );
}

export default function LeadPanel({ targetId, mode, firstLaunch, sender, onDecided }: {
  targetId: string; mode: "autopilot" | "copilot"; firstLaunch: string | null; sender: { name: string; photo: string | null };
  onDecided: (targetId: string, decision: "approve" | "reject") => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  useEffect(() => {
    let alive = true;
    // Fetch-on-select: the lead detail is external data, not derived state.
    void (async () => {
      setDetail(null); setMore(false);
      const d = await fetch(`/api/copilot/${targetId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (alive) setDetail(d);
    })();
    return () => { alive = false; };
  }, [targetId]);

  if (!detail) return <div className="flex flex-1 items-center justify-center"><RiLoader4Line size={28} className="animate-spin text-primary" /></div>;

  const c = detail.contact;
  const co = detail.company;
  const companyName = str(co?.name) ?? str(c.company);
  const size = str(co?.employee_range) ?? str(c.company_size);
  const industry = str(co?.industry) ?? str(c.company_industry);
  const place = str(co?.location) ?? str(c.company_location);
  const about = str(co?.description) ?? str(c.company_description);
  const companyUrl = str(co?.linkedin_url) ?? str(c.company_linkedin_url);
  const pending = detail.sequence.some((s) => s.draft?.status === "pending") || detail.loose_drafts.some((d) => d.status === "pending");
  const steps = detail.sequence.filter((s) => s.step_type !== "delay");
  const signal = detail.signals[0];
  const setDraft = (stepId: string, d: DraftRow) => setDetail((cur) => cur && { ...cur, sequence: cur.sequence.map((s) => (s.id === stepId ? { ...s, draft: d } : s)) });

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const r = await fetch(`/api/copilot/${targetId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: decision === "reject" ? "Rejected in Copilot" : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not update the lead");
      toast.success(decision === "approve" ? "Approved: outreach will start on schedule" : "Lead rejected");
      onDecided(targetId, decision);
      if (decision === "approve") setDetail((cur) => cur && { ...cur, sequence: cur.sequence.map((s) => (s.draft?.status === "pending" ? { ...s, draft: { ...s.draft, status: "approved" } } : s)) });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update the lead"); }
    finally { setBusy(null); }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-5 border-b border-[var(--border-subtle)] bg-gradient-to-r from-primary/[0.04] to-primary/[0.09] px-8 py-7">
        <Avatar name={str(c.full_name)} src={str(c.profile_image_url)} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[24px] text-[#5b4fd6]">{str(c.full_name) ?? "Unknown"}</span>
            {str(c.linkedin_url) && <a href={str(c.linkedin_url)!} target="_blank" rel="noreferrer" aria-label="LinkedIn profile" className="text-[#3730a3] hover:opacity-80"><RiLinkedinBoxFill size={24} /></a>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[17px] text-base-content/80">
            <span>{str(c.title) ?? str(c.headline)}</span>
            {companyName && <><span className="text-base-content/40">·</span><span>{companyName}</span>{companyUrl && <a href={companyUrl} target="_blank" rel="noreferrer" aria-label="Company on LinkedIn" className="text-[#3730a3] hover:opacity-80"><RiLinkedinBoxFill size={18} /></a>}</>}
          </div>
        </div>
        <HotLead score={typeof c.lead_score === "number" ? c.lead_score : null} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(companyName || about) && (
          <section className="space-y-4 border-b border-[var(--border-subtle)] px-8 py-7">
            <Caps>Company</Caps>
            <div className="flex flex-wrap gap-2">
              {companyName && <Chip>{companyName}</Chip>}
              {size && <Chip>{/employees/i.test(size) ? size : `${size} employees`}</Chip>}
              {industry && <Chip>{industry}</Chip>}
              {place && <Chip>{place}</Chip>}
            </div>
            {about && (
              <p className="text-[17px] leading-relaxed text-base-content/85">
                {more || about.length <= 160 ? about : `${about.slice(0, 160).trimEnd()}...`}{" "}
                {about.length > 160 && <button type="button" onClick={() => setMore(!more)} className="text-[#5b4fd6] hover:underline">{more ? "See less" : "See more"}</button>}
              </p>
            )}
          </section>
        )}

        {signal && (
          <section className="space-y-4 border-b border-[var(--border-subtle)] px-8 py-7">
            <Caps>Signal details</Caps>
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <Chip>{SIGNAL_LABEL[signal.type] ?? signal.type.replace(/_/g, " ")}</Chip>
              {signal.snippet && <Chip><RiKey2Line size={15} /> &quot;{signal.snippet.slice(0, 40)}&quot;</Chip>}
              <span className="text-base-content/75">
                {signal.source_url ? <a href={signal.source_url} target="_blank" rel="noreferrer" className="hover:underline">{signal.title}</a> : signal.title}
              </span>
            </div>
          </section>
        )}

        <section className="px-8 py-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[22px] font-medium">Campaign Sequence</div>
              {mode === "autopilot" && pending && <p className="mt-1 max-w-[520px] text-[15px] text-base-content/60">This campaign is scheduled, but you can still edit the messages before they are sent by the AI agent</p>}
            </div>
            {detail.agent && (
              <Link href={`/agents/${detail.agent.id}?tab=Campaign`} className="flex max-w-[420px] items-center gap-3 text-right text-[19px] text-[#5b4fd6] hover:underline">
                {detail.agent.workflow_name ?? detail.agent.name} <RiArrowRightDoubleLine size={26} className="shrink-0" />
              </Link>
            )}
          </div>
          {steps.length ? (
            <ol className="mt-5">
              {steps.map((s, i) => <StepItem key={s.id} n={i + 1} step={s} targetId={targetId} firstLaunch={firstLaunch} sender={sender} onDraft={setDraft} />)}
            </ol>
          ) : <p className="mt-4 text-[15px] text-base-content/55">This lead&apos;s agent has no sequence yet. Create it in the agent&apos;s Campaign tab.</p>}
        </section>
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] bg-gradient-to-r from-primary/[0.03] to-primary/[0.08] px-8 py-5">
        <div className="flex items-center gap-3">
          {pending ? (
            <button type="button" onClick={() => void decide("approve")} disabled={!!busy} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[17px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60">
              {busy === "approve" ? <RiLoader4Line size={18} className="animate-spin" /> : <RiCheckLine size={20} />} Approve
            </button>
          ) : <span className="inline-flex items-center gap-1.5 px-1 text-[20px] text-success"><RiCheckLine size={22} /> Approved</span>}
          {pending && (
            <button type="button" onClick={() => void decide("reject")} disabled={!!busy} className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[17px] hover:bg-base-200 disabled:opacity-60">
              {busy === "reject" ? <RiLoader4Line size={18} className="animate-spin" /> : <RiCloseLine size={20} />} Reject
            </button>
          )}
        </div>
        <ExportMenu detail={detail} />
      </footer>
    </div>
  );
}
