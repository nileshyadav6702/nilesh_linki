import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { RiCloseLine, RiSearchLine } from "react-icons/ri";
import LeadPanel, { type Lead } from "@/components/agents/LeadPanel";
import { Card, Empty, ghostBtn, inputCls, PageHeader, primaryBtn, ScoreBadge, SIGNAL_LABEL, SignalChip, StatusDot, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

const STATUS_FILTERS = [["", "Active"], ["drafted", "To review"], ["qualified", "Qualified"], ["enrolled", "In campaign"], ["disqualified", "Disqualified"], ["all", "All"]] as const;

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [state, setFilters] = useState<{ agent_id: string | null; status: string; signal_type: string; q: string }>({ agent_id: null, status: "", signal_type: "", q: "" });
  const [selected, setSelected] = useState<string | null>(null);
  // ?agent_id= seeds the agent filter until the user picks one.
  const filters = useMemo(() => ({ ...state, agent_id: state.agent_id ?? (typeof router.query.agent_id === "string" ? router.query.agent_id : "") }), [state, router.query.agent_id]);

  useEffect(() => { fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>).toString();
    const r = await fetch(`/api/leads?${qs}`);
    const d = await r.json();
    setLeads(d.leads ?? []);
    setTotal(d.total ?? 0);
  }, [filters]);
  useEffect(() => {
    if (!router.isReady) return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load, router.isReady]);

  const current = leads?.find((l) => l.id === selected) ?? null;

  return (
    <>
      <Head><title>Leads — Linki</title></Head>
      <div className="space-y-6">
        <PageHeader eyebrow="AI SDR" title="Leads" subtitle="People your agents found, ranked by fit and buying intent." actions={<Link href="/approvals" className={primaryBtn}>Review drafts</Link>} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35" size={15} />
            <input className={`${inputCls} pl-9`} placeholder="Search name, company…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <select className={`${inputCls} w-auto`} value={filters.agent_id} onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })} aria-label="Agent">
            <option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={`${inputCls} w-auto`} value={filters.signal_type} onChange={(e) => setFilters({ ...filters, signal_type: e.target.value })} aria-label="Signal">
            <option value="">All signals</option>{Object.entries(SIGNAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-base-200 p-1">
            {STATUS_FILTERS.map(([value, label]) => (
              <button key={label} onClick={() => setFilters({ ...filters, status: value })} className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition-all ${filters.status === value ? "border border-[var(--border-subtle)] bg-base-100 text-base-content shadow-[var(--shadow-raised)]" : "text-base-content/40 hover:text-base-content/70"}`}>{label}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-base-content/45 tabular-nums">{total} lead{total === 1 ? "" : "s"}</span>
        </div>

        {leads === null ? <p className="text-sm text-base-content/40">Loading…</p> : leads.length === 0 ? (
          <Empty title="No leads match yet"><p>Agents add leads as they detect signals. <Link className="underline" href="/agents">Check your agents</Link>.</p></Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-2">
              {leads.map((l) => (
                <button key={l.id} onClick={() => setSelected(l.id)} className={`block w-full rounded-2xl border bg-base-100 px-4 py-3 text-left shadow-[var(--shadow-raised)] transition-colors ${selected === l.id ? "border-[var(--border-strong)]" : "border-[var(--border-subtle)] hover:border-[var(--border)]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{l.full_name ?? "Unknown"}</div>
                      <div className="truncate text-xs text-base-content/55">{l.headline ?? [l.title, l.company].filter(Boolean).join(" at ")}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ScoreBadge score={l.lead_score ?? l.intent_score} verdict={l.fit_verdict} />
                      <StatusDot status={l.agent_status} />
                    </div>
                  </div>
                  {l.signals[0] && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-base-content/60">
                      <SignalChip type={l.signals[0].type} /><span className="truncate">{l.signals[0].title}</span><span className="ml-auto shrink-0 text-base-content/35">{timeAgo(l.signals[0].occurred_at)}</span>
                    </div>
                  )}
                  {l.drafts.length > 0 && <div className="mt-1.5 text-[11px] font-medium text-warning">Draft waiting for review</div>}
                </button>
              ))}
            </div>
            <div className="lg:sticky lg:top-4 lg:self-start">
              {current ? (
                <Card className="relative max-h-[calc(100vh-2rem)] overflow-y-auto">
                  <button className={`${ghostBtn} absolute right-3 top-3 lg:hidden`} onClick={() => setSelected(null)} aria-label="Close"><RiCloseLine size={16} /></button>
                  <LeadPanel lead={current} onChange={load} />
                </Card>
              ) : <div className="hidden rounded-2xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-base-content/40 lg:block">Select a lead to see why it was picked.</div>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
