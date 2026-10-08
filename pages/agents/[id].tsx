import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiDeleteBinLine, RiLinkedinBoxFill, RiMailLine, RiPauseLine, RiPlayLine, RiRefreshLine } from "react-icons/ri";
import AgentOverview, { ActivityList, type ActivityItem, type Budget, type DayPoint, type Performance } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import AgentSources, { type AgentSourceRow } from "@/components/agents/AgentSources";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import AgentCampaign from "@/components/agents/AgentCampaign";
import LeadsTable from "@/components/agents/LeadsTable";
import type { Step } from "@/components/agents/SequenceEditor";
import { Card, ghostBtn, nextRunLabel, outreachLabel, primaryBtn, secondaryBtn, senderLine, sourcingLabel, timeUntil } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { Icp } from "@/lib/icp/schema";

export const getServerSideProps = requireSignedIn;

interface StepRow { id: string; track: string; step_type: string; step_order: number; delay_seconds: number; contacts: number }
interface Detail {
  agent: AgentForm & { id: string; status: string; outreach_enabled: number; icp_id: string | null; last_run_at: string | null; last_error: string | null; list_id: string | null; channel: string };
  sources: AgentSourceRow[]; linkedin_budget: Budget | null;
  counts: { by_status: Record<string, number>; today: Record<string, number>; ai_cost_30d_usd: number };
  sequence: Array<Omit<Step, "draft">>; workflow: { id: string; name: string } | null;
  performance: Performance; series: DayPoint[]; activity: ActivityItem[]; next_run_at: string | null; due_today: number; steps: StepRow[];
  senders: {
    linkedin: { name: string | null; email: string | null; daily_connection_limit: number | null; daily_message_limit: number | null; is_authenticated: number } | null;
    email: { from_email: string | null; from_name: string | null; daily_email_limit: number | null; ramp_up_enabled: number | null; ramp_start_date: string | null } | null;
  };
  sender_pool: { linkedin: number; email: number };
}

const TABS = ["Overview", "Leads", "Sources", "Campaign", "Activity", "Settings"] as const;

export default function AgentDetail() {
  const router = useRouter();
  const id = String(router.query.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [icp, setIcp] = useState<Icp>(EMPTY_ICP);
  const [icpKey, setIcpKey] = useState(0);
  const [editingIcp, setEditingIcp] = useState(false);
  const [activityFilter, setActivityFilter] = useState<"all" | "discovery" | "campaign" | "setup">("all");
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
  useEffect(() => {
    const requested = typeof router.query.tab === "string" ? router.query.tab : "";
    if ((TABS as readonly string[]).includes(requested)) setTab(requested as (typeof TABS)[number]);
  }, [router.query.tab]);

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
  const leadCount = Object.values(d.counts.by_status).reduce((x, y) => x + y, 0);
  const pool = d.sender_pool ?? { linkedin: 0, email: 0 };
  const attached = !!(d.senders.linkedin || d.senders.email);
  const senderName = senderLine(d.senders.linkedin?.name, d.senders.email?.from_email, pool);
  const soonest = d.sources.filter((s) => s.enabled && s.next_run_at).sort((x, y) => String(x.next_run_at).localeCompare(String(y.next_run_at)))[0];
  const launch = !soonest ? "No source scheduled" : !soonest.last_run_at && timeUntil(soonest.next_run_at) === "due" ? "First run is scheduled now" : `Next launch ${nextRunLabel(soonest.next_run_at, soonest.last_run_at)}`;

  return (
    <>
      <Head><title>{a.name} — Agents — Linki</title></Head>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <p className="mb-2 text-[13px] font-medium text-base-content/45"><Link href="/agents" className="hover:underline">Agents</Link></p>
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-.03em]">{a.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/60">
              {d.senders.linkedin && <RiLinkedinBoxFill className="text-[#0a66c2]" size={16} />}
              {d.senders.email && <RiMailLine className="text-error" size={16} />}
              <span>{senderName}</span>
              {!attached && (pool.linkedin + pool.email > 0
                ? <button type="button" className="text-primary" onClick={() => setTab("Settings")}>Choose a sender</button>
                : <Link href="/settings" className="text-primary">Add a sender</Link>)}
              <span className="text-base-content/40">{launch}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${finding ? "bg-info/10 text-info" : "bg-base-200"}`}>{sourcingLabel(a.status)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sending ? "bg-success/10 text-success" : "bg-base-200"}`}>{outreachLabel(sending)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={secondaryBtn} disabled={busy} onClick={runNow}><RiRefreshLine size={16} /> Launch now</button>
            {sending
              ? <button className={secondaryBtn} onClick={() => patch({ outreach_enabled: false }, "Outreach paused")}><RiPauseLine size={16} /> Pause outreach</button>
              : <button className={primaryBtn} onClick={() => patch({ outreach_enabled: true }, "Outreach started")}><RiPlayLine size={16} /> Start outreach</button>}
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
              {t}{t === "Leads" ? <span className="ml-1.5 rounded bg-base-200 px-1.5 text-xs">{leadCount}</span> : null}
            </button>
          ))}
        </div>

        {tab === "Overview" && (
          <AgentOverview performance={d.performance} series={d.series} activity={d.activity} dueToday={d.due_today} budget={d.linkedin_budget} onReview={() => setTab("Leads")} onActivity={() => setTab("Activity")} />
        )}
        {tab === "Leads" && <LeadsTable agentId={a.id} showAgent={false} openLeadId={typeof router.query.lead === "string" ? router.query.lead : undefined} />}
        {tab === "Sources" && (
          <div className="space-y-4">
            {editingIcp && (
              <Card className="space-y-4">
                <IcpEditor key={icpKey} value={icp} onChange={setIcp} />
                <div className="flex gap-2">
                  <button className={primaryBtn} onClick={async () => { await saveIcp(); setEditingIcp(false); }}>Save targeting</button>
                  <button className={secondaryBtn} onClick={() => setEditingIcp(false)}>Cancel</button>
                </div>
              </Card>
            )}
            <AgentSources key={d.sources.map((s) => `${s.id}:${s.enabled}`).join()} agentId={a.id} icp={icp} rows={d.sources} hasLinkedIn={!!a.linkedin_account_id} onChanged={load} onEditTargeting={() => setEditingIcp(true)} />
          </div>
        )}
        {tab === "Campaign" && (
          <AgentCampaign
            workflowId={d.workflow?.id ?? null}
            counts={Object.fromEntries(d.steps.map((s) => [s.id, s.contacts]))}
            onChanged={load}
            onCreate={async () => { await patch({ create_default_campaign: true }, "Sequence created"); }}
          />
        )}
        {tab === "Activity" && (
          <div className="space-y-3">
            <div className="flex gap-1 rounded-[10px] bg-base-200 p-1 w-fit">
              {(["all", "discovery", "campaign", "setup"] as const).map((f) => (
                <button key={f} onClick={() => setActivityFilter(f)} className={`rounded-[7px] px-3 py-1.5 text-xs font-medium capitalize ${activityFilter === f ? "bg-base-100 shadow-[var(--shadow-raised)]" : "text-base-content/50"}`}>{f}</button>
              ))}
            </div>
            <ActivityList items={d.activity} filter={activityFilter} />
          </div>
        )}
        {tab === "Settings" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <div className="text-xs uppercase tracking-wide text-base-content/40">LinkedIn sender</div>
                <div className="mt-1 font-medium">{d.senders.linkedin?.name || d.senders.linkedin?.email || "Not connected"}</div>
                {d.senders.linkedin && <div className="mt-1 text-xs text-base-content/50">{d.senders.linkedin.daily_connection_limit ?? 20} connections / day · {d.senders.linkedin.daily_message_limit ?? 40} messages / day · {d.senders.linkedin.is_authenticated ? "signed in" : "logged out"}</div>}
              </Card>
              <Card>
                <div className="text-xs uppercase tracking-wide text-base-content/40">Email sender</div>
                <div className="mt-1 font-medium">{d.senders.email?.from_email || "No mailbox"}</div>
                {d.senders.email && <div className="mt-1 text-xs text-base-content/50">{d.senders.email.daily_email_limit ?? 50} emails / day · warmup {d.senders.email.ramp_up_enabled ? "on" : "off"}</div>}
              </Card>
            </div>
            <AgentSettings agentId={a.id} initial={a} onSaved={load} />
          </div>
        )}
      </div>
    </>
  );
}
