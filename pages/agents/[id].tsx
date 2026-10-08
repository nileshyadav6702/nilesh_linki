import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import type { ReactNode } from "react";
import {
  RiArrowLeftSLine, RiFlowChart, RiCheckboxCircleFill, RiDashboardLine, RiDeleteBinLine, RiErrorWarningLine, RiFocus3Line, RiHistoryLine, RiLineChartLine,
  RiLinkedinBoxFill, RiLoader4Line, RiMailLine, RiPauseCircleLine, RiPlayLine, RiRadarLine, RiRocketLine, RiSearchEyeLine, RiSendPlaneLine, RiSettings3Line,
  RiTeamLine, RiTimeLine, RiUserAddLine,
} from "react-icons/ri";
import AgentOverview, { ActivityList, type ActivityItem, type Budget, type DayPoint, type Performance } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import AgentSources, { type AgentSourceRow } from "@/components/agents/AgentSources";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import AgentCampaign from "@/components/agents/AgentCampaign";
import LeadsTable from "@/components/agents/LeadsTable";
import type { Step } from "@/components/agents/SequenceEditor";
import {
  Avatar, Callout, Card, ghostBtn, IconTile, nextRunLabel, Panel, Pill, primaryBtn, RunSwitch, secondaryBtn, SectionHeading, Segmented, senderLine, TabBar, timeUntil, type Tone,
} from "@/components/agents/ui";
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
const TAB_ICONS: Partial<Record<(typeof TABS)[number], ReactNode>> = {
  Overview: <RiDashboardLine size={15} />, Leads: <RiTeamLine size={15} />, Sources: <RiRadarLine size={15} />,
  Campaign: <RiFlowChart size={15} />, Activity: <RiHistoryLine size={15} />, Settings: <RiSettings3Line size={15} />,
};
const ACTIVITY_FILTERS = ["all", "discovery", "campaign", "setup"] as const;

function SenderRow({ icon, tone, name, kind, status, limits }: { icon: ReactNode; tone: Tone; name: string; kind: string; status: "connected" | "logged_out" | "none"; limits: ReactNode[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] px-4 py-3.5">
      <IconTile icon={icon} tone={tone} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-base-content">{name}</span>
          {status === "connected" && <Pill tone="success"><RiCheckboxCircleFill size={12} /> Connected</Pill>}
          {status === "logged_out" && <Pill tone="error"><RiErrorWarningLine size={12} /> Logged out</Pill>}
        </div>
        <div className="text-[13px] text-base-content/50">{kind}</div>
      </div>
      {limits.length > 0 && <div className="flex flex-wrap gap-2">{limits.map((l, i) => <Pill key={i}>{l}</Pill>)}</div>}
    </div>
  );
}

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

  const waiting = (d.counts.by_status.enrolled ?? 0) + (d.counts.by_status.approved ?? 0);
  const li = d.senders.linkedin;
  const mail = d.senders.email;

  return (
    <>
      <Head><title>{a.name} — Agents — Linki</title></Head>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <Link href="/agents" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-base-content/45 hover:text-base-content"><RiArrowLeftSLine size={16} /> Agents</Link>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <IconTile icon={<RiFocus3Line size={20} />} size={40} />
              <h1 className="min-w-0 truncate font-display text-[28px] leading-[1.15] text-base-content">{a.name}</h1>
              <Pill tone={finding ? "success" : a.status === "draft" ? "ink" : "amber"}>
                {finding ? <RiLoader4Line size={13} className="animate-spin" /> : <RiPauseCircleLine size={13} />}
                {finding ? "Finding leads" : a.status === "draft" ? "Draft" : "Paused"}
              </Pill>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-base-content/65">
              {attached ? <Avatar name={li?.name || senderName} size={24} /> : <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
              <span className="font-medium text-base-content/80">{li?.name || senderName}</span>
              {li && (
                <>
                  <Pill><RiUserAddLine size={13} /> {li.daily_connection_limit ?? 20}/day</Pill>
                  <Pill><RiSendPlaneLine size={13} /> {li.daily_message_limit ?? 40}/day</Pill>
                </>
              )}
              {mail && (
                <>
                  <span className="hidden h-4 w-px bg-[var(--border-subtle)] sm:block" />
                  <span className="inline-flex min-w-0 items-center gap-1.5"><RiMailLine className="shrink-0 text-error" size={16} /><span className="truncate">{mail.from_email}</span></span>
                  {!!mail.ramp_up_enabled && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Ramping up</span>}
                </>
              )}
              {!attached && (pool.linkedin + pool.email > 0
                ? <button type="button" className="font-medium text-primary" onClick={() => setTab("Settings")}>Choose a sender</button>
                : <Link href="/settings" className="font-medium text-primary">Add a sender</Link>)}
              <span className="inline-flex items-center gap-1 text-xs text-base-content/45"><RiTimeLine size={13} />{launch}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunSwitch label="Sourcing" on={finding} onChange={() => patch({ status: finding ? "paused" : "active" }, finding ? "Lead sourcing paused" : "Lead sourcing on")} />
            <RunSwitch label="Outreach" on={sending} onChange={() => patch({ outreach_enabled: !sending }, sending ? "Outreach paused" : "Outreach on")} />
            <button className={secondaryBtn} disabled={busy} onClick={runNow}><RiRocketLine size={16} /> Launch now</button>
            <button className={ghostBtn + " !h-10 !w-10 !px-0"} onClick={remove} aria-label="Delete agent" title="Delete agent"><RiDeleteBinLine size={17} /></button>
          </div>
        </div>
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
          <div className="space-y-4">
            <Segmented options={ACTIVITY_FILTERS} value={activityFilter} onChange={setActivityFilter} labels={{
              all: "All",
              discovery: <><RiSearchEyeLine size={14} /> Lead discovery</>,
              campaign: <><RiSendPlaneLine size={14} /> Campaign</>,
              setup: <><RiSettings3Line size={14} /> Setup</>,
            }} />
            <ActivityList items={d.activity} filter={activityFilter} />
          </div>
        )}
        {tab === "Settings" && (
          <div className="space-y-6">
            <Panel className="p-6">
              <SectionHeading title="Senders" subtitle="The accounts this agent sends from." />
              <div className="mt-5 space-y-3">
                <SenderRow icon={<RiLinkedinBoxFill size={20} />} tone="linkedin" name={li?.name || li?.email || "No LinkedIn account"} kind="LinkedIn sender"
                  status={li ? (li.is_authenticated ? "connected" : "logged_out") : "none"}
                  limits={li ? [<><RiUserAddLine size={13} /> {li.daily_connection_limit ?? 20}/day</>, <><RiSendPlaneLine size={13} /> {li.daily_message_limit ?? 40}/day</>] : []} />
                <SenderRow icon={<RiMailLine size={20} />} tone="error" name={mail?.from_email || "No mailbox"} kind="Email sender"
                  status={mail ? "connected" : "none"}
                  limits={mail ? [<><RiSendPlaneLine size={13} /> {mail.daily_email_limit ?? 50}/day</>, <><RiLineChartLine size={13} /> warmup {mail.ramp_up_enabled ? "on" : "off"}</>] : []} />
              </div>
            </Panel>
            <AgentSettings agentId={a.id} initial={a} onSaved={load} />
          </div>
        )}
      </div>
    </>
  );
}
