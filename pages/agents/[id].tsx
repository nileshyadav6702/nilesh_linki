import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiErrorWarningLine, RiPlayLine } from "react-icons/ri";
import { formatDistanceToNowStrict } from "date-fns";
import ActivityFeed from "@/components/agents/activity/ActivityFeed";
import AgentHeader from "@/components/agents/AgentHeader";
import AgentOverview, { type ActivityItem, type Budget, type DayPoint, type Performance } from "@/components/agents/AgentOverview";
import AgentSettings, { type AgentForm } from "@/components/agents/AgentSettings";
import AgentSources, { type AgentSourceRow } from "@/components/agents/AgentSources";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import TargetingDrawer from "@/components/agents/targeting/TargetingDrawer";
import AgentCampaign from "@/components/agents/AgentCampaign";
import { ContactsWorkspace } from "@/components/contacts/ContactsWorkspace";
import { FindingLeadsToast, LeadsFinderTip } from "@/components/agents/LaunchNotice";
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
  performance: Performance; series: DayPoint[]; activity: ActivityItem[]; next_run_at: string | null; due_today: number; next_outreach_at?: string | null; steps: StepRow[];
  senders: {
    linkedin: { name: string | null; email: string | null; daily_connection_limit: number | null; daily_message_limit: number | null; is_authenticated: number } | null;
    email: { from_email: string | null; from_name: string | null; daily_email_limit: number | null; ramp_up_enabled: number | null; ramp_start_date: string | null } | null;
  };
  sender_pool: { linkedin: number; email: number };
  credits?: { balance: number; next_refill: number };
}

/** Columns an agent's Leads tab leaves out (the agent is implied; lists and import date live on Contacts). */
const AGENT_LEAD_HIDDEN = ["agent", "list", "imported"];
const TABS = ["Overview", "Leads", "Sources", "Campaign", "Activity", "Settings"] as const;


/** "Next launch in 12 hours" under Pause Outreach: when outreach next sends, and what that means. */
function launchInfo(sending: boolean, at: string | null): { lead: string; when: string; tip: string } | null {
  if (!sending || !at) return null;
  const t = Date.parse(at);
  const now = Number.isNaN(t) || t <= Date.now() + 60_000;
  const when = now ? "now" : `in ${formatDistanceToNowStrict(t)}`;
  return {
    lead: "Next launch", when,
    tip: `The outreach campaign ${now ? "is sending now" : `begins ${when}`}. Lead detection and scoring run continuously. Your daily sending limit is shared across your active campaigns. Approved leads enter the queue gradually, and the rest will follow over the coming days.`,
  };
}

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
  // Fresh from the new-agent wizard: show the "finding leads" card and the Leads tab tip once.
  const [launched, setLaunched] = useState(() => router.query.launched === "1");
  const [tipOpen, setTipOpen] = useState(launched);

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

  /** Saves the edited targeting as a new ICP version and points the agent at it. */
  async function saveIcp(next: Icp): Promise<boolean> {
    const r = await fetch("/api/icp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: next, website_url: icpWebsite ?? undefined }) });
    const row = await r.json();
    if (!r.ok) { toast.error(row.error ?? "Could not save ICP"); return false; }
    return patch({ icp_id: row.id }, `ICP v${row.version} saved — new leads are scored against it`);
  }

  if (!d) return <p className="text-[15px] text-base-content/40">Loading…</p>;
  const a = d.agent;
  const finding = a.status === "active";
  const sending = !!a.outreach_enabled;
  const leadCount = Object.values(d.counts.by_status).reduce((x, y) => x + y, 0);
  const soonest = d.sources.filter((s) => s.enabled && s.next_run_at).sort((x, y) => String(x.next_run_at).localeCompare(String(y.next_run_at)))[0];
  const launch = !soonest ? "No source scheduled" : !soonest.last_run_at && timeUntil(soonest.next_run_at) === "due" ? "First run is scheduled now" : `Next launch ${nextRunLabel(soonest.next_run_at, soonest.last_run_at)}`;

  const waiting = (d.counts.by_status.enrolled ?? 0) + (d.counts.by_status.approved ?? 0);

  return (
    <>
      <Head><title>{a.name} — Agents — Kairo</title></Head>
      <div className="space-y-6">
        <AgentHeader
          name={a.name} status={a.status} outreachOn={sending} senders={d.senders}
          statusTip={finding ? `Finding leads · ${launch}` : a.status === "draft" ? "Draft — launch it to start finding leads" : `Lead sourcing is paused · ${launch}`}
          onToggleOutreach={() => patch({ outreach_enabled: !sending }, sending ? "Outreach paused" : "Outreach started")}
          onSenderSettings={() => setTab("Settings")}
          nextLaunch={launchInfo(sending, d.next_outreach_at ?? null)}
        />
        {a.last_error && <Callout tone="error" icon={<RiErrorWarningLine size={17} />}>{a.last_error}</Callout>}
        {!sending && waiting > 0 && (
          <Panel className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <IconTile icon={<RiPlayLine size={18} />} size={40} />
              <div><div className="font-medium text-base-content">Your outreach is paused</div><div className="text-[15px] text-base-content/55">{waiting} approved contact(s) are waiting to be contacted.</div></div>
            </div>
            <button className={primaryBtn} onClick={() => patch({ outreach_enabled: true }, "Outreach started")}><RiPlayLine size={16} /> Restart outreach</button>
          </Panel>
        )}

        <div className="relative">
          <TabBar tabs={TABS} value={tab} onChange={setTab} counts={{ Leads: leadCount }} />
          {tipOpen && <LeadsFinderTip onClose={() => setTipOpen(false)} />}
        </div>
        {launched && <FindingLeadsToast leadCount={leadCount} onClose={() => { setLaunched(false); void router.replace({ pathname: router.pathname, query: { id } }, undefined, { shallow: true }); }} />}

        {tab === "Overview" && (
          <AgentOverview agentId={a.id} credits={d.credits} performance={d.performance} series={d.series} activity={d.activity} dueToday={d.due_today} budget={d.linkedin_budget} onReview={() => setTab("Leads")} onActivity={() => setTab("Activity")} />
        )}
        {tab === "Leads" && <ContactsWorkspace base={{ agent: a.id }} hidden={AGENT_LEAD_HIDDEN} sizesKey="linki.agent-leads.columns.v3" className="h-[calc(100vh-150px)] min-h-[520px]"
          openLeadId={typeof router.query.lead === "string" ? router.query.lead : undefined} />}
        {tab === "Sources" && (
          <div className="space-y-4">
            {editingIcp && <TargetingDrawer icp={icp} websiteUrl={icpWebsite} onClose={() => setEditingIcp(false)} onSave={saveIcp} />}
            <AgentSources openImport={router.query.add === "1"} agentId={a.id} agentName={a.name} ownListId={a.list_id} autoEnrichEmails={!!a.enrich_emails && a.channel !== "linkedin"} icp={icp} rows={d.sources}
              hasLinkedIn={!!a.linkedin_account_id} onChanged={load} onEditTargeting={() => setEditingIcp(true)}
              sourcing={finding} onToggleSourcing={() => patch({ status: finding ? "paused" : "active" }, finding ? "Lead sourcing paused" : "Lead sourcing on")} />
          </div>
        )}
        {tab === "Campaign" && (
          <AgentCampaign
            agentId={a.id}
            workflowId={d.workflow?.id ?? null}
            stats={d.steps}
            leadCount={leadCount}
            sources={{ count: d.sources.filter((s) => s.enabled).length, leads: d.sources.reduce((n, s) => n + (Number((s as { leads?: number }).leads) || 0), 0) }}
            settings={{ goal: a.goal, tone: a.tone, exclude_first_degree: a.exclude_first_degree, language: a.language, split_messages: a.split_messages }}
            hasEmailSender={!!a.email_account_id}
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
