import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiDeleteBinLine, RiPauseLine, RiPlayLine, RiRefreshLine, RiSendPlaneLine } from "react-icons/ri";
import AgentOverview, { type Budget, type DetectorRun, type FunnelRow } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import AgentSources, { type AgentSourceRow } from "@/components/agents/AgentSources";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import LeadsTable from "@/components/agents/LeadsTable";
import SequenceEditor, { type Step } from "@/components/agents/SequenceEditor";
import { Card, ghostBtn, primaryBtn, secondaryBtn, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { Icp } from "@/lib/icp/schema";

export const getServerSideProps = requireSignedIn;

interface Detail {
  agent: AgentForm & { id: string; status: string; outreach_enabled: number; icp_id: string | null; last_run_at: string | null; last_error: string | null; list_id: string | null; channel: string };
  sources: AgentSourceRow[]; runs: DetectorRun[]; funnel: FunnelRow[]; linkedin_budget: Budget | null;
  counts: { by_status: Record<string, number>; today: Record<string, number>; ai_cost_30d_usd: number };
  sequence: Array<Omit<Step, "draft">>; workflow: { id: string; name: string } | null;
}

const TABS = ["Overview", "Leads", "Sources", "Campaign", "ICP", "Settings"] as const;

export default function AgentDetail() {
  const router = useRouter();
  const id = String(router.query.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [icp, setIcp] = useState<Icp>(EMPTY_ICP);
  const [icpKey, setIcpKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const fetchDetail = useCallback(async (): Promise<{ data: Detail; icp: Icp | null } | null> => {
    if (!id) return null;
    const r = await fetch(`/api/agents/${id}`);
    if (!r.ok) { toast.error("Agent not found"); router.push("/agents"); return null; }
    const data = await r.json() as Detail;
    const icpRes = await fetch(`/api/icp${data.agent.icp_id ? `?id=${data.agent.icp_id}` : ""}`).then((x) => x.json()).catch(() => null);
    return { data, icp: icpRes?.icp?.data ?? null };
  }, [id, router]);
  const apply = useCallback((x: { data: Detail; icp: Icp | null } | null) => {
    if (!x) return;
    setD(x.data);
    if (x.icp) { setIcp(x.icp); setIcpKey((k) => k + 1); }
  }, []);
  const load = useCallback(() => fetchDetail().then(apply), [fetchDetail, apply]);
  useEffect(() => {
    let alive = true;
    fetchDetail().then((x) => { if (alive) apply(x); });
    return () => { alive = false; };
  }, [fetchDetail, apply]);

  async function patch(body: Record<string, unknown>, ok: string) {
    const r = await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Update failed");
    toast.success(ok);
    load();
  }

  async function runNow() {
    setBusy(true);
    const r = await fetch(`/api/agents/${id}/run`, { method: "POST" });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(data.error ?? "Run failed");
    toast.success(`Scored ${data.pass?.scored ?? 0}, drafted ${data.pass?.drafted ?? 0}${data.linkedin_sources_queued ? ` · ${data.linkedin_sources_queued} LinkedIn source(s) queued` : ""}`);
    if (data.note) toast.message(data.note);
    load();
  }

  async function saveIcp() {
    const r = await fetch("/api/icp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: icp }) });
    const row = await r.json();
    if (!r.ok) return toast.error(row.error ?? "Could not save ICP");
    await patch({ icp_id: row.id }, `ICP v${row.version} saved — new leads are scored against it`);
  }

  async function remove() {
    if (!confirm("Delete this agent? Its leads and campaign stay; discovery stops.")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    router.push("/agents");
  }

  if (!d) return <p className="text-sm text-base-content/40">Loading…</p>;
  const a = d.agent;
  const finding = a.status === "active";
  const sending = !!a.outreach_enabled;

  return (
    <>
      <Head><title>{a.name} — Agents — Linki</title></Head>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <p className="mb-2 text-[13px] font-medium text-base-content/45"><Link href="/agents" className="hover:underline">Agents</Link></p>
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-.03em]">{a.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ${finding ? "bg-info/10 text-info" : "bg-base-200 text-base-content/55"}`}>
                <span className={`h-1.5 w-1.5 rounded-full bg-current ${finding ? "animate-pulse" : ""}`} />{finding ? "Finding leads" : "Lead finding paused"}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ${sending ? "bg-success/10 text-success" : "bg-base-200 text-base-content/55"}`}>{sending ? "Outreach on" : "Outreach paused"}</span>
              <span className="capitalize text-base-content/50">{a.mode}</span>
              <span className="text-base-content/45">Last run {timeAgo(a.last_run_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-sm">
              <input type="checkbox" className="toggle toggle-sm" checked={finding} onChange={() => patch({ status: finding ? "paused" : "active" }, finding ? "Lead finding paused" : "Finding leads")} /> Finding leads
            </label>
            <button className={secondaryBtn} disabled={busy} onClick={runNow}><RiRefreshLine size={16} /> Run now</button>
            {sending
              ? <button className={secondaryBtn} onClick={() => patch({ outreach_enabled: false }, "Outreach paused")}><RiPauseLine size={16} /> Pause outreach</button>
              : <button className={primaryBtn} onClick={() => patch({ outreach_enabled: true }, "Outreach started")}><RiSendPlaneLine size={16} /> Start outreach</button>}
            <button className={ghostBtn} onClick={remove} aria-label="Delete agent"><RiDeleteBinLine size={16} /></button>
          </div>
        </div>
        {a.last_error && <p className="rounded-xl bg-error/5 px-4 py-3 text-sm text-error">{a.last_error}</p>}
        {!sending && (d.counts.by_status.enrolled ?? 0) + (d.counts.by_status.approved ?? 0) > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 !py-4">
            <div><div className="font-medium">Your outreach is paused</div><div className="text-sm text-base-content/55">{(d.counts.by_status.enrolled ?? 0) + (d.counts.by_status.approved ?? 0)} approved contact(s) are waiting to be contacted.</div></div>
            <button className={primaryBtn} onClick={() => patch({ outreach_enabled: true }, "Outreach started")}><RiPlayLine size={16} /> Restart outreach</button>
          </Card>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)]">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t ? "border-primary text-base-content" : "border-transparent text-base-content/45 hover:text-base-content/70"}`}>
              {t}{t === "Leads" ? <span className="ml-1.5 rounded bg-base-200 px-1.5 text-xs">{Object.values(d.counts.by_status).reduce((x, y) => x + y, 0)}</span> : null}
            </button>
          ))}
        </div>

        {tab === "Overview" && <AgentOverview counts={d.counts} funnel={d.funnel} runs={d.runs} budget={d.linkedin_budget} />}
        {tab === "Leads" && <LeadsTable agentId={a.id} showAgent={false} />}
        {tab === "Sources" && <AgentSources key={d.sources.map((s) => `${s.id}:${s.enabled}`).join()} agentId={a.id} icp={icp} rows={d.sources} hasLinkedIn={!!a.linkedin_account_id} onChanged={load} />}
        {tab === "Campaign" && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-semibold">{d.workflow?.name ?? "No campaign"}</div><div className="text-sm text-base-content/50">{d.sequence.length} steps · qualified leads enter this campaign once approved. Every message step is drafted per lead in Copilot.</div></div>
              {d.workflow && <Link href={`/workflows/${d.workflow.id}`} className={secondaryBtn}>Edit campaign</Link>}
            </div>
            <SequenceEditor steps={d.sequence.map((s) => ({ ...s, draft: null }))} />
          </Card>
        )}
        {tab === "ICP" && (
          <Card className="space-y-4">
            <IcpEditor key={icpKey} value={icp} onChange={setIcp} />
            <button className={primaryBtn} onClick={saveIcp}>Save as new ICP version</button>
          </Card>
        )}
        {tab === "Settings" && <AgentSettings agentId={a.id} initial={a} onSaved={load} />}
      </div>
    </>
  );
}
