import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiCheckLine, RiCloseLine, RiExternalLinkLine } from "react-icons/ri";
import SequenceEditor, { type Draft } from "@/components/agents/SequenceEditor";
import type { LeadDetail } from "@/components/agents/LeadDrawer";
import { Card, Empty, Flames, inputCls, PageHeader, primaryBtn, secondaryBtn, SignalChip, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface QueueRow { id: string; full_name: string | null; title: string | null; headline: string | null; company: string | null; lead_score: number | null; agent_name: string | null; agent_mode: string | null; drafts: number; auto_approve_at: string | null }

function minutesUntil(iso: string | null): string | null {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  return m <= 0 ? "any moment" : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
}

/** Copilot: review what agents will send — every step, per contact — then approve or reject the contact. */
export default function CopilotPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(() => fetch(`/api/copilot${agentId ? `?agent_id=${agentId}` : ""}`).then((r) => r.json()).then((rows: QueueRow[]) => {
    setQueue(rows);
    setCurrent((cur) => (cur && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null));
  }), [agentId]);

  useEffect(() => { fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    fetch(`/api/copilot${agentId ? `?agent_id=${agentId}` : ""}`).then((r) => r.json()).then((rows: QueueRow[]) => {
      if (!alive) return;
      setQueue(rows);
      const wanted = typeof router.query.contact === "string" ? router.query.contact : null;
      setCurrent((cur) => wanted && rows.some((r) => r.id === wanted) ? wanted : cur && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null);
    });
    return () => { alive = false; };
  }, [agentId, router.query.contact]);
  useEffect(() => {
    let alive = true;
    if (current) fetch(`/api/copilot/${current}`).then((r) => r.ok ? r.json() : null).then((d) => { if (alive) setDetail(d); });
    return () => { alive = false; };
  }, [current]);

  async function decide(decision: "approve" | "reject") {
    if (!current) return;
    setBusy(true);
    const r = await fetch(`/api/copilot/${current}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(d.error ?? "Failed");
    toast.success(decision === "approve" ? (d.enrolled ? "Approved — added to the campaign" : `Approved${d.reason ? ` (${d.reason})` : ""}`) : "Rejected");
    setDetail(null);
    loadQueue();
  }

  const onDraftChange = (draft: Draft) => setDetail((d) => d ? { ...d, sequence: d.sequence.map((s) => s.draft?.id === draft.id ? { ...s, draft: { ...s.draft, ...draft } } : s) } : d);
  const c = detail?.contact;
  const row = queue?.find((x) => x.id === current);

  return (
    <>
      <Head><title>Copilot — Linki</title></Head>
      <div className="space-y-5">
        <PageHeader eyebrow="AI SDR" title="Copilot" subtitle="Review and act on what your agents prepared. Nothing is sent until you approve (or autopilot's window passes)."
          actions={<select className={`${inputCls} w-auto`} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent"><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>} />

        {queue === null ? <p className="text-sm text-base-content/40">Loading…</p> : queue.length === 0 ? (
          <Empty title="Nothing to review">Drafts appear as agents qualify leads. <Link className="underline" href="/leads">See all leads</Link>.</Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <Card className="!p-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
              <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Scheduled actions <span className="font-normal text-base-content/45">· {queue.length}</span></div>
              <ul>
                {queue.map((q) => (
                  <li key={q.id}>
                    <button onClick={() => setCurrent(q.id)} className={`w-full border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors ${current === q.id ? "bg-base-200" : "hover:bg-base-200/60"}`}>
                      <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{q.full_name ?? "Unknown"}</span><Flames score={q.lead_score} /></div>
                      <div className="truncate text-xs text-base-content/50">{[q.title ?? q.headline, q.company].filter(Boolean).join(" · ")}</div>
                      <div className="mt-1 text-[11px] text-base-content/40">{q.drafts} message{q.drafts === 1 ? "" : "s"} · {q.agent_name}{q.auto_approve_at ? ` · autopilot ${minutesUntil(q.auto_approve_at)}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {!detail || !c ? <p className="text-sm text-base-content/40">Loading…</p> : (
              <Card className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold">{String(c.full_name ?? "Unknown")}</h2>{c.linkedin_url && <a href={String(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-base-content/45 hover:text-base-content" aria-label="LinkedIn"><RiExternalLinkLine size={15} /></a>}</div>
                    <p className="text-sm text-base-content/60">{String(c.headline ?? [c.title, c.company].filter(Boolean).join(" at "))}</p>
                  </div>
                  <div className="text-right"><Flames score={c.lead_score as number | null} /><div className="text-[11px] text-base-content/45">{Number(c.lead_score ?? 0) >= 70 ? "Hot lead" : "Lead score"} {c.lead_score !== null ? Math.round(Number(c.lead_score)) : ""}</div></div>
                </div>

                {detail.company && (
                  <div className="space-y-1.5"><h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">Company</h3>
                    <div className="flex flex-wrap gap-1.5 text-xs">{[detail.company.name, detail.company.industry, detail.company.employee_count ? `${detail.company.employee_count} employees` : null, detail.company.location].filter(Boolean).map((x) => <span key={String(x)} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5">{String(x)}</span>)}</div>
                  </div>
                )}

                <div className="space-y-1.5"><h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/45">Signal details</h3>
                  {detail.signals.slice(0, 3).map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm"><SignalChip type={s.type} /><span>{s.title}</span>{s.snippet && <span className="text-base-content/50">— {s.snippet}</span>}<span className="text-xs text-base-content/35">{timeAgo(s.occurred_at)}</span></div>
                  ))}
                  {c.fit_reason && <p className="text-sm text-base-content/60">Why they fit: {String(c.fit_reason)}</p>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Campaign sequence</h3>
                    {detail.agent && <Link href={`/agents/${detail.agent.id}`} className="truncate text-xs text-[var(--viz-1,#2563eb)] hover:underline">{detail.agent.workflow_name ?? detail.agent.name}</Link>}
                  </div>
                  <p className="text-xs text-base-content/50">Edit any message before approving. Steps run on the days shown after the contact joins the campaign.</p>
                  <SequenceEditor steps={detail.sequence} onDraftChange={onDraftChange} />
                </div>

                <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-base-100 px-5 py-3">
                  <span className="text-xs text-base-content/45">{row?.auto_approve_at ? `Autopilot sends ${minutesUntil(row.auto_approve_at)} unless rejected` : "Waiting for your approval"}</span>
                  <span className="flex gap-2">
                    <button className={secondaryBtn} disabled={busy} onClick={() => decide("reject")}><RiCloseLine size={16} /> Reject</button>
                    <button className={primaryBtn} disabled={busy} onClick={() => decide("approve")}><RiCheckLine size={16} /> Approve</button>
                  </span>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
