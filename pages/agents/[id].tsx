import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiDeleteBinLine, RiPauseLine, RiPlayLine, RiRefreshLine } from "react-icons/ri";
import AgentOverview, { type Budget, type DetectorRun, type FunnelRow } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import SourcePicker, { type SourceDraft } from "@/components/agents/SourcePicker";
import { Card, ghostBtn, PageHeader, primaryBtn, secondaryBtn, StatusDot, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { Icp } from "@/lib/icp/schema";

export const getServerSideProps = requireSignedIn;

interface Source { id: string; source_type: string; config_json: string; enabled: number; last_run_at: string | null; next_run_at: string | null; last_error: string | null }
interface Detail {
  agent: AgentForm & { id: string; status: string; icp_id: string | null; last_run_at: string | null; last_error: string | null; list_id: string | null };
  sources: Source[]; runs: DetectorRun[]; funnel: FunnelRow[]; linkedin_budget: Budget | null;
  counts: { by_status: Record<string, number>; today: Record<string, number>; ai_cost_30d_usd: number };
}

const TABS = ["Overview", "Signals", "ICP", "Settings"] as const;

export default function AgentDetail() {
  const router = useRouter();
  const id = String(router.query.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [sources, setSources] = useState<SourceDraft[]>([]);
  const [icp, setIcp] = useState<Icp>(EMPTY_ICP);
  const [icpKey, setIcpKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: Detail, icpData: Icp | null) => {
    setD(data);
    setSources(data.sources.map((s) => ({ source_type: s.source_type, enabled: !!s.enabled, config: JSON.parse(s.config_json || "{}") })));
    if (icpData) { setIcp(icpData); setIcpKey((k) => k + 1); }
  }, []);

  const fetchDetail = useCallback(async (): Promise<{ data: Detail; icp: Icp | null } | null> => {
    if (!id) return null;
    const r = await fetch(`/api/agents/${id}`);
    if (!r.ok) { toast.error("Agent not found"); router.push("/agents"); return null; }
    const data = await r.json() as Detail;
    const icpRes = await fetch(`/api/icp${data.agent.icp_id ? `?id=${data.agent.icp_id}` : ""}`).then((x) => x.json()).catch(() => null);
    return { data, icp: icpRes?.icp?.data ?? null };
  }, [id, router]);

  const load = useCallback(() => fetchDetail().then((x) => { if (x) apply(x.data, x.icp); }), [fetchDetail, apply]);
  useEffect(() => {
    let alive = true;
    fetchDetail().then((x) => { if (alive && x) apply(x.data, x.icp); });
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
    toast.success(`Scored ${data.pass.scored}, drafted ${data.pass.drafted}${data.linkedin_sources_queued ? ` · ${data.linkedin_sources_queued} LinkedIn source(s) queued` : ""}`);
    if (data.note) toast.message(data.note);
    load();
  }

  async function saveSources() {
    if (!d) return;
    setBusy(true);
    for (const s of sources) {
      const existing = d.sources.find((x) => x.source_type === s.source_type);
      const req = existing
        ? fetch(`/api/agents/${id}/sources`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: existing.id, enabled: s.enabled, config: s.config }) })
        : s.enabled ? fetch(`/api/agents/${id}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }) : null;
      const r = req && await req;
      if (r && !r.ok) { toast.error((await r.json()).error ?? `Could not save ${s.source_type}`); setBusy(false); return; }
    }
    setBusy(false);
    toast.success("Signals saved");
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

  return (
    <>
      <Head><title>{a.name} — Agents — Linki</title></Head>
      <div className="space-y-6">
        <PageHeader eyebrow="AI agent" title={a.name}
          subtitle={<span className="flex flex-wrap items-center gap-3"><StatusDot status={a.status} /><span className="capitalize">{a.mode}</span><span>Last run {timeAgo(a.last_run_at)}</span><Link className="underline" href={`/leads?agent_id=${a.id}`}>View leads</Link></span>}
          actions={<>
            <button className={secondaryBtn} disabled={busy} onClick={runNow}><RiRefreshLine size={16} /> Run now</button>
            {a.status === "active"
              ? <button className={secondaryBtn} onClick={() => patch({ status: "paused" }, "Agent paused")}><RiPauseLine size={16} /> Pause</button>
              : <button className={primaryBtn} onClick={() => patch({ status: "active" }, "Agent running")}><RiPlayLine size={16} /> Activate</button>}
            <button className={ghostBtn} onClick={remove} aria-label="Delete agent"><RiDeleteBinLine size={16} /></button>
          </>} />
        {a.last_error && <p className="rounded-xl bg-error/5 px-4 py-3 text-sm text-error">{a.last_error}</p>}

        <div className="flex gap-0.5 rounded-[10px] bg-base-200 p-1 w-fit">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition-all ${tab === t ? "border border-[var(--border-subtle)] bg-base-100 text-base-content shadow-[var(--shadow-raised)]" : "text-base-content/40 hover:text-base-content/70"}`}>{t}</button>
          ))}
        </div>

        {tab === "Overview" && <AgentOverview counts={d.counts} funnel={d.funnel} runs={d.runs} budget={d.linkedin_budget} />}
        {tab === "Signals" && (
          <Card className="space-y-4">
            <SourcePicker value={sources} onChange={setSources} hasLinkedIn={!!a.linkedin_account_id} />
            {d.sources.some((s) => s.last_error) && (
              <div className="space-y-1">{d.sources.filter((s) => s.last_error).map((s) => <p key={s.id} className="text-xs text-error">{s.source_type}: {s.last_error}</p>)}</div>
            )}
            <button className={primaryBtn} disabled={busy} onClick={saveSources}>Save signals</button>
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
