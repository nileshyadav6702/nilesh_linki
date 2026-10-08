import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import type { ReactNode } from "react";
import {
  RiFlowChart, RiDashboardLine, RiErrorWarningLine, RiHistoryLine, RiPlayLine, RiRadarLine, RiSettings3Line, RiTeamLine,
} from "react-icons/ri";
import ActivityFeed from "@/components/agents/activity/ActivityFeed";
import AgentHeader from "@/components/agents/AgentHeader";
import AgentOverview, { type ActivityItem, type Budget, type DayPoint, type Performance } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import AgentSources, { type AgentSourceRow } from "@/components/agents/AgentSources";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import TargetingDrawer from "@/components/agents/targeting/TargetingDrawer";
import AgentCampaign from "@/components/agents/AgentCampaign";
import LeadsTable from "@/components/agents/LeadsTable";
import type { Step } from "@/components/agents/SequenceEditor";
import {
  Callout, IconTile, nextRunLabel, Panel, primaryBtn, TabBar, timeUntil,
} from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { Icp } from "@/lib/icp/schema";

export const getServerSideProps = requireSignedIn;

interface StepRow { id: string; track: string; step_type: string; step_order: number; delay_seconds: number; contacts: number; invited?: number; accepted?: number }
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
const TAB_ICONS: Partial<Record<(typeof TABS)[number], ReactNode>> = {
  Overview: <RiDashboardLine size={15} />, Leads: <RiTeamLine size={15} />, Sources: <RiRadarLine size={15} />,
  Campaign: <RiFlowChart size={15} />, Activity: <RiHistoryLine size={15} />, Settings: <RiSettings3Line size={15} />,
};


export default function AgentDetail() {
  const router = useRouter();
  const id = String(router.query.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => {
    const t = typeof router.query.tab === "string" ? router.query.tab : "";
    return (TABS as readonly string[]).includes(t) ? t as (typeof TABS)[number] : "Overview";
  });
  const [icp, setIcp] = useState<Icp>(EMPTY_ICP);
  const [icpWebsite, setIcpWebsite] = useState<string | null>(null);
  const [editingIcp, setEditingIcp] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchDetail = useCallback(async (): Promise<{ data: Detail; icp: Icp | null; website: string | null } | null> => {
    if (!id) return null;
    const r = await fetch(`/api/agents/${id}`);
    if (!r.ok) { toast.error("Agent not found"); router.push("/agents"); return null; }
    const data = await r.json() as Detail;
    const icpRes = await fetch(`/api/icp${data.agent.icp_id ? `?id=${data.agent.icp_id}` : ""}`).then((x) => x.json()).catch(() => null);
    return { data, icp: icpRes?.icp?.data ?? null, website: icpRes?.icp?.website_url ?? null };
  }, [id, router]);
  const apply = useCallback((x: { data: Detail; icp: Icp | null; website: string | null } | null) => {
    if (!x) return;
    setD(x.data);
    if (x.icp) { setIcp(x.icp); setIcpWebsite(x.website); }
  }, []);
  const load = useCallback(() => fetchDetail().then(apply), [fetchDetail, apply]);
  useEffect(() => {
    let alive = true;
    fetchDetail().then((x) => { if (alive) apply(x); });
    return () => { alive = false; };
  }, [fetchDetail, apply]);
  // Follow ?tab= when it changes (adjusting state during render, per React docs, not in an effect).
  const requestedTab = typeof router.query.tab === "string" ? router.query.tab : "";
  const [prevRequestedTab, setPrevRequestedTab] = useState(requestedTab);
  if (requestedTab !== prevRequestedTab) {
    setPrevRequestedTab(requestedTab);
    if ((TABS as readonly string[]).includes(requestedTab)) setTab(requestedTab as (typeof TABS)[number]);
  }

  async function patch(body: Record<string, unknown>, ok: string): Promise<boolean> {
    const r = await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { toast.error((await r.json()).error ?? "Update failed"); return false; }
    toast.success(ok);
    load();
    return true;
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

  /** Saves the edited targeting as a new ICP version and points the agent at it. */
  async function saveIcp(next: Icp): Promise<boolean> {
    const r = await fetch("/api/icp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: next, website_url: icpWebsite ?? undefined }) });
    const row = await r.json();
    if (!r.ok) { toast.error(row.error ?? "Could not save ICP"); return false; }
    return patch({ icp_id: row.id }, `ICP v${row.version} saved — new leads are scored against it`);
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
  const soonest = d.sources.filter((s) => s.enabled && s.next_run_at).sort((x, y) => String(x.next_run_at).localeCompare(String(y.next_run_at)))[0];
  const launch = !soonest ? "No source scheduled" : !soonest.last_run_at && timeUntil(soonest.next_run_at) === "due" ? "First run is scheduled now" : `Next launch ${nextRunLabel(soonest.next_run_at, soonest.last_run_at)}`;

  const waiting = (d.counts.by_status.enrolled ?? 0) + (d.counts.by_status.approved ?? 0);

  return (
    <>
      <Head><title>{a.name} — Agents — Linki</title></Head>
      <div className="space-y-6">
        <AgentHeader
          name={a.name} status={a.status} outreachOn={sending} senders={d.senders} busy={busy}
          statusTip={finding ? `Finding leads · ${launch}` : a.status === "draft" ? "Draft — launch it to start finding leads" : `Lead sourcing is paused · ${launch}`}
          onToggleOutreach={() => patch({ outreach_enabled: !sending }, sending ? "Outreach paused" : "Outreach started")}
          onToggleSourcing={() => patch({ status: finding ? "paused" : "active" }, finding ? "Lead sourcing paused" : "Lead sourcing on")}
          onLaunch={runNow} onDelete={remove} onSenderSettings={() => setTab("Settings")}
        />
        {a.last_error && <Callout tone="error" icon={<RiErrorWarningLine size={17} />}>{a.last_error}</Callout>}
        {!sending && waiting > 0 && (
          <Panel className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <IconTile icon={<RiPlayLine size={18} />} size={40} />
              <div><div className="font-medium text-base-content">Your outreach is paused</div><div className="text-sm text-base-content/55">{waiting} approved contact(s) are waiting to be contacted.</div></div>
            </div>
            <button className={primaryBtn} onClick={() => patch({ outreach_enabled: true }, "Outreach started")}><RiPlayLine size={16} /> Restart outreach</button>
          </Panel>
        )}

        <TabBar tabs={TABS} value={tab} onChange={setTab} counts={{ Leads: leadCount }} icons={TAB_ICONS} />

        {tab === "Overview" && (
          <AgentOverview performance={d.performance} series={d.series} activity={d.activity} dueToday={d.due_today} budget={d.linkedin_budget} onReview={() => setTab("Leads")} onActivity={() => setTab("Activity")} />
        )}
        {tab === "Leads" && <LeadsTable agentId={a.id} showAgent={false} openLeadId={typeof router.query.lead === "string" ? router.query.lead : undefined} />}
        {tab === "Sources" && (
          <div className="space-y-4">
            {editingIcp && <TargetingDrawer icp={icp} websiteUrl={icpWebsite} onClose={() => setEditingIcp(false)} onSave={saveIcp} />}
            <AgentSources agentId={a.id} agentName={a.name} ownListId={a.list_id} autoEnrichEmails={!!a.enrich_emails && a.channel !== "linkedin"} icp={icp} rows={d.sources}
              hasLinkedIn={!!a.linkedin_account_id} onChanged={load} onEditTargeting={() => setEditingIcp(true)} />
          </div>
        )}
        {tab === "Campaign" && (
          <AgentCampaign
            agentId={a.id}
            workflowId={d.workflow?.id ?? null}
            stats={d.steps}
            leadCount={leadCount}
            sources={{ count: d.sources.filter((s) => s.enabled).length, leads: d.sources.reduce((n, s) => n + (Number((s as { leads?: number }).leads) || 0), 0) }}
            settings={{ goal: a.goal, tone: a.tone, exclude_first_degree: a.exclude_first_degree }}
            onChanged={load}
            onCreate={async () => { await patch({ create_default_campaign: true }, "Sequence created"); }}
            onEditSources={() => setTab("Sources")}
          />
        )}
        {tab === "Activity" && (
          <ActivityFeed agentId={a.id} onViewLeads={(signal) => {
            void router.replace({ pathname: router.pathname, query: { ...router.query, tab: "Leads", signal } }, undefined, { shallow: true }).then(() => setTab("Leads"));
          }} />
        )}
        {tab === "Settings" && <AgentSettings agentId={a.id} initial={a} onSaved={load} />}
      </div>
    </>
  );
}
