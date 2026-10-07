import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiExternalLinkLine, RiMailLine, RiSearchLine } from "react-icons/ri";
import type { Step } from "@/components/agents/SequenceEditor";
import { Flames, ghostBtn, ScoreBadge, secondaryBtn, SignalChip, StatusDot, timeAgo } from "@/components/agents/ui";

export interface LeadDetail {
  contact: Record<string, string | number | null>;
  company: Record<string, string | number | null> | null;
  signals: Array<{ id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string }>;
  agent: { id: string; name: string; workflow_name: string | null; mode: string } | null;
  sequence: Step[];
  outreach: Array<{ track: string; state: string; current_step: number; next_step_at: string | null }>;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-[var(--border-subtle)] px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">{title}</h3>
      {children}
    </section>
  );
}

/** Side panel with everything about a lead: signals, company, sequence and score. Opens from any list. */
export default function LeadDrawer({ targetId, onClose, onChanged }: { targetId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [d, setD] = useState<LeadDetail | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!targetId) return Promise.resolve();
    return fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then((x) => setD(x));
  }, [targetId]);
  useEffect(() => {
    let alive = true;
    if (targetId) fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then((x) => { if (alive) { setD(x); setOpenStep(null); } });
    return () => { alive = false; };
  }, [targetId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(action: string, reason?: string) {
    const r = await fetch(`/api/leads/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const x = await r.json();
    if (!r.ok) return toast.error(x.error ?? "Failed");
    if (action === "find_email") toast[x.found ? "success" : "message"](x.found ? `Found ${x.email}` : "No email found");
    else toast.success(action === "skip" ? "Lead skipped" : "Done");
    await load();
    onChanged?.();
  }

  if (!targetId) return null;
  const c = d?.contact;
  const pending = d?.sequence.some((s) => s.draft?.status === "pending");
  const shown = d?.sequence.find((s) => s.id === openStep);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead details">
      <button className="absolute inset-0 bg-black/20" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-[520px] flex-col bg-base-100 shadow-[var(--shadow-popover)]">
        {!d || !c ? <p className="p-6 text-sm text-base-content/40">Loading…</p> : (
          <>
            <header className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">{str(c.full_name) ?? "Unknown"}</h2>
                  {str(c.linkedin_url) && <a href={String(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-base-content/45 hover:text-base-content" aria-label="LinkedIn profile"><RiExternalLinkLine size={15} /></a>}
                </div>
                <p className="text-sm text-base-content/60">{str(c.headline) ?? [str(c.title), str(c.company)].filter(Boolean).join(" at ")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {str(c.email) ? <span className="inline-flex items-center gap-1 text-base-content/70"><RiMailLine size={12} />{String(c.email)}</span>
                    : <button className={ghostBtn} onClick={() => act("find_email")}><RiSearchLine size={12} /> Find email</button>}
                  <StatusDot status={str(c.agent_status)} />
                  <Flames score={c.lead_score as number | null} />
                </div>
              </div>
              <button className={ghostBtn} onClick={onClose} aria-label="Close"><RiCloseLine size={18} /></button>
            </header>

            <div className="flex-1 overflow-y-auto">
              <Section title={`${d.signals.length} signal${d.signals.length === 1 ? "" : "s"}`}>
                {d.signals.length === 0 && <p className="text-sm text-base-content/45">None recorded.</p>}
                <ol className="space-y-2.5">
                  {d.signals.map((s) => (
                    <li key={s.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><SignalChip type={s.type} /><span className="font-medium">{s.title}</span></span><span className="shrink-0 text-xs text-base-content/40">{timeAgo(s.occurred_at)}</span></div>
                      {s.snippet && <p className="mt-0.5 text-base-content/60">{s.snippet}</p>}
                      {s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" className="text-xs text-base-content/45 underline">Source</a>}
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Fit">
                <div className="flex items-center gap-3 text-sm"><ScoreBadge score={c.lead_score as number | null} verdict={str(c.fit_verdict)} /><span className="text-base-content/50">fit {c.fit_score ?? "—"} · intent {Math.round(Number(c.intent_score ?? 0))}</span></div>
                {str(c.fit_reason) && <p className="text-sm text-base-content/70">{String(c.fit_reason)}</p>}
                {str(c.skip_reason) && <p className="text-xs text-base-content/45">Skipped: {String(c.skip_reason)}</p>}
              </Section>

              {d.company && (
                <Section title="Company">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {[d.company.name, d.company.industry, d.company.employee_count ? `${d.company.employee_count} employees` : null, d.company.location].filter(Boolean).map((x) => <span key={String(x)} className="rounded-full bg-base-200 px-2 py-0.5">{String(x)}</span>)}
                  </div>
                  {str(d.company.description) && <p className="text-sm text-base-content/60 line-clamp-3">{String(d.company.description)}</p>}
                </Section>
              )}

              {d.agent && (
                <Section title="Campaign sequence">
                  <Link href={`/agents/${d.agent.id}`} className="text-sm text-[var(--viz-1,#2563eb)] hover:underline">{d.agent.workflow_name ?? d.agent.name}</Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.sequence.map((s) => (
                      <button key={s.id} onClick={() => setOpenStep(openStep === s.id ? null : s.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${openStep === s.id ? "border-[var(--border-strong)] bg-base-200" : "border-[var(--border-subtle)] hover:bg-base-200"}`}>
                        {s.label}{s.draft ? " ✦" : ""}
                      </button>
                    ))}
                  </div>
                  {shown ? (
                    <div className="rounded-xl bg-base-200 p-3 text-sm whitespace-pre-wrap">
                      {shown.draft ? <>{shown.draft.subject && <div className="mb-1 font-medium">{shown.draft.subject}</div>}{shown.draft.body}<div className="mt-2 text-[11px] uppercase text-base-content/40">{shown.draft.status === "consumed" ? "sent" : shown.draft.status}</div></>
                        : <span className="text-base-content/50">{shown.channel ? "Written at send time by the campaign." : "No message for this step."}</span>}
                    </div>
                  ) : <p className="text-xs text-base-content/40">Click a step to see its message.</p>}
                  {pending && <Link href={`/copilot?contact=${targetId}`} className={`${secondaryBtn} h-8 text-xs`}>Review drafts in Copilot</Link>}
                </Section>
              )}

              <Section title="Basic information">
                <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
                  {([["Title", c.title], ["Company", c.company], ["Location", c.location], ["Phone", c.phone], ["Source", c.lead_source], ["Added", c.created_at ? timeAgo(String(c.created_at)) : null]] as Array<[string, unknown]>)
                    .filter(([, v]) => str(v)).map(([k, v]) => <Fragment key={k}><dt className="text-base-content/45">{k}</dt><dd className="truncate">{String(v)}</dd></Fragment>)}
                </dl>
              </Section>
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
              {c.agent_status !== "skipped" && c.agent_status !== "enrolled" && c.agent_id
                ? <button className={secondaryBtn} onClick={() => act("skip", "Rejected from lead panel")}>Reject</button> : <span />}
              <Link href={`/contacts/${targetId}`} className={ghostBtn}>Open full profile <RiExternalLinkLine size={12} /></Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
