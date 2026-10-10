import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LuTrendingDown, LuTrendingUp } from "react-icons/lu";
import {
  RiAddLine, RiArrowDownSLine, RiBriefcase4Line, RiChat3Line, RiCodeSSlashLine, RiCopperCoinLine, RiEditBoxLine, RiFileList3Line, RiFocus3Line,
  RiGlobalLine, RiGroupLine, RiHashtag, RiLineChartLine, RiMoneyDollarCircleLine, RiMoreFill, RiRadarLine, RiUserSearchLine, RiUserStarLine,
} from "react-icons/ri";
import Confirm from "@/components/contacts/Confirm";
import { failToast } from "@/components/settings/billing/credits-toast";
import { FloatingMenu } from "@/components/agents/leads/Menu";
import LeadSourcesDrawer from "@/components/agents/sources/LeadSourcesDrawer";
import { formatDistanceToNowStrict } from "date-fns";
import { SIGNAL_LABEL, Toggle } from "@/components/agents/ui";
import type { Icp } from "@/lib/icp/schema";
import { roleTitles, sizeLabel } from "@/lib/icp/targeting";

export interface SourceItemRow { key: string; label: string; sub: string; leads: number; volume: "high" | "low" }
export interface UnitView { item_key: string; state: "active" | "attention" | "waiting"; next_run_at: string; cadence_hours: number; note: string | null }
export interface AgentSourceRow {
  id: string; source_type: string; config_json: string; enabled: number; last_run_at: string | null; next_run_at: string | null; last_error: string | null; leads: number;
  items?: SourceItemRow[];
  /** The scheduler's clock per tracked item ("*" for on/off signals). */
  schedule?: UnitView[];
}

/** Sources that track a list of things (pages, topics, boards, lists) show each one as a row. */
const GROUP_TITLE: Record<string, string> = {
  competitor_engagement: "Competitor engagement", keyword_engagement: "Topic engagement", influencer_engagement: "Expert engagement",
  own_content_engagement: "Your content engagement", hiring: "Hiring", existing_list: "Saved lists", linkedin_import: "LinkedIn imports",
  tech_stack: "Tech stack", company_followers: "Company page followers",
};
const UNIT: Record<string, [string, string]> = {
  competitor_engagement: ["competitor", "competitors"], keyword_engagement: ["topic", "topics"], influencer_engagement: ["expert", "experts"],
  own_content_engagement: ["profile", "profiles"], hiring: ["job board", "job boards"], existing_list: ["list", "lists"], linkedin_import: ["list", "lists"],
  tech_stack: ["technology", "technologies"], company_followers: ["page", "pages"],
};
/** Item-less sources (a buying event each) are grouped together, the way they read to a user. */
const EVENT_TITLE: Record<string, string> = {
  funding: "Recently raised funds", job_change: "Recently changed jobs", technology: "Uses a technology", website_visit: "Visited your website",
  top_active: "Top 5% active profiles in your ICP", new_decision_maker: "New decision-makers in role", hiring_surge: "Hiring surge", profile_visitors: "Profile visitors",
  lookalike: "Lookalike prospects",
};

const LOOK: Record<string, { icon: ReactNode; cls: string }> = {
  competitor_engagement: { icon: <RiFocus3Line size={24} />, cls: "bg-[#fdecef] text-[#e5484d]" },
  keyword_engagement: { icon: <RiHashtag size={24} />, cls: "bg-[#eef0fe] text-[#5b5bd6]" },
  influencer_engagement: { icon: <RiUserStarLine size={24} />, cls: "bg-[#fdecef] text-[#e5484d]" },
  own_content_engagement: { icon: <RiChat3Line size={24} />, cls: "bg-[#e7f6f2] text-[#1f9d86]" },
  hiring: { icon: <RiUserSearchLine size={24} />, cls: "bg-[#fff4e0] text-[#d98a1a]" },
  existing_list: { icon: <RiFileList3Line size={24} />, cls: "bg-base-200 text-base-content/70" },
  linkedin_import: { icon: <RiFileList3Line size={24} />, cls: "bg-[#e8f1fb] text-[#0a66c2]" },
  events: { icon: <RiLineChartLine size={24} />, cls: "bg-[#fff4e0] text-[#e8870e]" },
  tech_stack: { icon: <RiCodeSSlashLine size={24} />, cls: "bg-[#e3f5ea] text-[#16a34a]" },
  company_followers: { icon: <RiGroupLine size={24} />, cls: "bg-[#fde8f1] text-[#db2777]" },
};
const EVENT_ICON: Record<string, ReactNode> = {
  funding: <RiMoneyDollarCircleLine size={18} />, job_change: <RiBriefcase4Line size={18} />, technology: <RiCodeSSlashLine size={18} />, website_visit: <RiGlobalLine size={18} />,
  top_active: <RiLineChartLine size={18} />, new_decision_maker: <RiUserStarLine size={18} />, hiring_surge: <RiUserSearchLine size={18} />, profile_visitors: <RiGroupLine size={18} />,
};

/** "~ in 5 hours" until the source's next scheduled run. */
function nextLabel(s: AgentSourceRow): string {
  if (!s.enabled) return "Off";
  if (!s.next_run_at) return "Not scheduled";
  const t = Date.parse(s.next_run_at.includes("T") || s.next_run_at.endsWith("Z") ? s.next_run_at : `${s.next_run_at.replace(" ", "T")}Z`);
  return Number.isNaN(t) || t <= Date.now() ? "~ now" : `~ in ${formatDistanceToNowStrict(t)}`;
}

/** "Every 8h", "Daily", "Every 3 days", "Weekly" from a unit's current cadence. */
export function cadenceLabel(hours: number): string {
  if (hours < 20) return `Every ${Math.max(1, Math.round(hours))}h`;
  if (hours < 36) return "Daily";
  if (hours < 140) return `Every ${Math.round(hours / 24)} days`;
  return "Weekly";
}

const untilLabel = (isoTime: string) => {
  const t = Date.parse(isoTime);
  return Number.isNaN(t) || t <= Date.now() ? "~ now" : `~ in ${formatDistanceToNowStrict(t)}`;
};

/** Next run cell: when, how often, or why it is waiting / needs attention. */
function NextCell({ s, units }: { s: AgentSourceRow; units: UnitView[] }) {
  if (!s.enabled) return <div className="text-right text-[16px] text-base-content/50">Off</div>;
  if (!units.length) return <div className="text-right text-[16px] text-base-content/70">{nextLabel(s)}</div>;
  const attention = units.find((u) => u.state === "attention");
  if (attention) return <div className="text-right" title={attention.note ?? undefined}><div className="text-[15.5px] font-medium text-error">Needs attention</div><div className="truncate text-[13.5px] text-error/80">{attention.note}</div></div>;
  const soonest = units.reduce((a, b) => (Date.parse(a.next_run_at) <= Date.parse(b.next_run_at) ? a : b));
  const fastest = Math.min(...units.map((u) => u.cadence_hours));
  return (
    <div className="text-right" title={soonest.note ?? undefined}>
      <div className="text-[16px] text-base-content/75">{untilLabel(soonest.next_run_at)}</div>
      <div className={`truncate text-[13.5px] ${soonest.note ? "text-[#b7791f]" : "text-base-content/45"}`}>{soonest.note ?? cadenceLabel(fastest)}</div>
    </div>
  );
}

function Volume({ v }: { v: "high" | "low" }) {
  return v === "high"
    ? <span className="inline-flex items-center gap-1.5 text-[15.5px] text-[#1f9d86]"><LuTrendingUp size={18} /> High volume</span>
    : <span className="inline-flex items-center gap-1.5 text-[15.5px] text-base-content/45"><LuTrendingDown size={18} /> Low volume</span>;
}

function Initial({ label }: { label: string }) {
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#fdf1ec] text-[16px] font-medium text-base-content/70">{(label.trim()[0] ?? "?").toUpperCase()}</span>;
}

const COLS = "grid grid-cols-[minmax(0,1fr)_150px_150px_160px_64px] items-center gap-4";

/** "Who this agent targets" + "How this agent finds leads": every signal with its leads, next run, Launch now and toggles. */
export default function AgentSources({ agentId, agentName, ownListId, autoEnrichEmails, icp, rows, hasLinkedIn, sourcing, onToggleSourcing, onChanged, onEditTargeting, openImport = false }: {
  agentId: string; agentName: string; ownListId: string | null; autoEnrichEmails: boolean; icp: Icp; rows: AgentSourceRow[]; hasLinkedIn: boolean;
  /** Whether the agent is finding leads (the "Active" switch). */
  sourcing: boolean; onToggleSourcing: () => void;
  onChanged: () => void; onEditTargeting?: () => void;
  /** Open the Lead sources drawer on its import options right away (Contacts → Add leads). */
  openImport?: boolean;
}) {
  const [editing, setEditing] = useState(openImport);
  const [askLaunch, setAskLaunch] = useState<{ source: AgentSourceRow; item: SourceItemRow | null } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ anchor: HTMLElement; source: AgentSourceRow; item: SourceItemRow | null } | null>(null);
  const chips = [...new Set([...roleTitles(icp), ...icp.industries, ...icp.company_types, ...icp.company_sizes.map(sizeLabel), ...icp.geographies])];

  const lookalike = rows.find((r) => r.source_type === "lookalike");
  const listed = rows.filter((r) => r.source_type !== "lookalike");
  const grouped = listed.filter((r) => GROUP_TITLE[r.source_type]);
  const events = listed.filter((r) => !GROUP_TITLE[r.source_type]);
  const signalRows = grouped.reduce((n, s) => n + Math.max(1, s.items?.length ?? 0), 0) + events.length;
  const activeRows = grouped.filter((s) => s.enabled).reduce((n, s) => n + Math.max(1, s.items?.length ?? 0), 0) + events.filter((s) => s.enabled).length;

  async function setEnabled(s: AgentSourceRow, enabled: boolean) {
    const r = await fetch(`/api/agents/${agentId}/sources`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: s.id, enabled }) });
    if (!r.ok) { toast.error("Could not update"); return false; }
    return true;
  }
  async function toggle(s: AgentSourceRow) { if (await setEnabled(s, !s.enabled)) onChanged(); }
  async function toggleEvents() {
    const on = !events.every((e) => e.enabled);
    for (const e of events) if (!!e.enabled !== on) await setEnabled(e, on);
    onChanged();
  }
  async function toggleLookalike() {
    if (lookalike) return toggle(lookalike);
    const r = await fetch(`/api/agents/${agentId}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_type: "lookalike", config: {} }) });
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not turn this on");
    toast.success("Kairo will add prospects that closely match your target");
    onChanged();
  }
  async function launch(s: AgentSourceRow, item: SourceItemRow | null) {
    const r = await fetch(`/api/agents/${agentId}/run?source_id=${s.id}${item ? `&item=${encodeURIComponent(item.key)}` : ""}`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) return failToast(d, "Launch failed");
    toast.success(d.linkedin_sources_queued ? "Queued for the next LinkedIn pass" : `${d.http_sources?.[0]?.ingested ?? 0} new lead(s) found`);
    onChanged();
  }
  /** Remove one tracked item from its source; removing the last one (or an event source) deletes the source. */
  async function remove(s: AgentSourceRow, item: SourceItemRow | null) {
    const keys = s.items?.map((i) => i.key) ?? [];
    const last = !item || keys.length <= 1;
    const r = last
      ? await fetch(`/api/agents/${agentId}/sources?source_id=${s.id}`, { method: "DELETE" })
      : await fetch(`/api/agents/${agentId}/sources`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: s.id, config: withoutItem(s, item!.key) }) });
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not remove the signal");
    toast.success("Signal removed");
    onChanged();
  }

  const childRow = (s: AgentSourceRow, item: SourceItemRow | null, label: string, sub: string | null, leads: number, icon?: ReactNode) => (
    <div key={`${s.id}:${item?.key ?? "self"}`} className={`${COLS} border-t border-[var(--border-subtle)] py-4 pl-[136px] pr-8 first:border-t-0`}>
      <div className="flex min-w-0 items-center gap-4">
        {icon ? <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#fdf1ec] text-[#e8870e]">{icon}</span> : <Initial label={label} />}
        <div className="min-w-0">
          <div className="truncate text-[18px] text-base-content">{label}</div>
          {sub && <div className="truncate text-[15.5px] text-base-content/55">{sub}</div>}
        </div>
      </div>
      <button type="button" disabled={!s.enabled} onClick={() => setAskLaunch({ source: s, item })}
        className="inline-flex h-10 items-center justify-center gap-2 justify-self-end rounded-[8px] bg-base-200 px-3.5 text-[15.5px] text-base-content/80 transition-colors hover:bg-base-300 disabled:opacity-40">
        <RiCopperCoinLine size={17} /> Launch now
      </button>
      <div className="text-right">
        <div className="text-[19px] tabular-nums text-base-content">{leads}</div>
        {item && <Volume v={item.volume} />}
      </div>
      <NextCell s={s} units={(s.schedule ?? []).filter((u) => u.item_key === (item?.key ?? "*") || (!item && u.item_key !== "*" && !(s.items ?? []).length))} />
      <button type="button" aria-label={`Actions for ${label}`} onClick={(e) => setMenu({ anchor: e.currentTarget, source: s, item })}
        className="flex h-9 w-9 items-center justify-center justify-self-end rounded-full text-base-content/50 hover:bg-base-200 hover:text-base-content"><RiMoreFill size={22} /></button>
    </div>
  );

  const groupRow = (key: string, title: string, sub: string, leads: number, next: ReactNode, on: boolean, onToggle: () => void, look: { icon: ReactNode; cls: string }, children: ReactNode, error?: string | null) => {
    const expanded = !!open[key];
    return (
      <div key={key} className="border-t border-[var(--border-subtle)]">
        <div className={`${COLS} px-8 py-5`}>
          <div className="flex min-w-0 items-center gap-4">
            <button type="button" aria-expanded={expanded} aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`} onClick={() => setOpen({ ...open, [key]: !expanded })}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${expanded ? "border border-base-content/50" : "hover:bg-base-200"}`}>
              <RiArrowDownSLine size={22} className={`text-base-content/60 transition-transform ${expanded ? "" : "-rotate-90"}`} />
            </button>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] ${look.cls}`}>{look.icon}</span>
            <div className="min-w-0">
              <div className="truncate text-[19px] font-medium text-base-content">{title}</div>
              <div className="truncate text-[16px] text-base-content/55">{sub}</div>
              {error && <div className="mt-0.5 truncate text-[14px] text-error" title={error}>{error}</div>}
            </div>
          </div>
          <span />
          <div className="text-right text-[19px] tabular-nums text-base-content">{leads}</div>
          {next}
          <div className="justify-self-end"><Toggle on={on} onChange={onToggle} label={`Turn ${title} ${on ? "off" : "on"}`} /></div>
        </div>
        {expanded && <div className="wizard-rise pb-2">{children}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-10">
      {askLaunch && (
        <Confirm title="Launch Agent" badge="BETA" action="Launch" onCancel={() => setAskLaunch(null)}
          onConfirm={async () => { const a = askLaunch; setAskLaunch(null); await launch(a.source, a.item); }}
          text={<>This launch costs <b>10 credits</b> and will run immediately. Results can take up to <b>30 minutes</b> to appear.<br /><br />Depending on the signal, there may be no new leads found.</>} />
      )}
      {menu && (
        <FloatingMenu anchor={menu.anchor} label="Signal actions" width={220} onClose={() => setMenu(null)}
          items={[{ label: "Remove signal", danger: true, onSelect: () => { const m = menu; setMenu(null); void remove(m.source, m.item); } }]} />
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-[24px] font-semibold text-base-content">Who this agent targets</h2>
          <p className="text-[16.5px] text-base-content/60">Every source below only finds leads that match this audience.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-7 py-6">
          {chips.slice(0, 5).map((c) => <span key={c} className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 text-[16.5px] text-base-content/80">{c}</span>)}
          {chips.length > 5 && <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[16.5px] text-base-content/45">+{chips.length - 5}</span>}
          {!chips.length && <span className="text-[16px] text-base-content/45">No targeting yet.</span>}
          {onEditTargeting && (
            <button type="button" onClick={onEditTargeting} className="ml-auto inline-flex items-center gap-2 text-[17px] text-base-content hover:text-primary">
              <RiEditBoxLine size={20} /> Edit targeting
            </button>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[24px] font-semibold text-base-content">How this agent finds leads</h2>
            <p className="text-[16.5px] text-base-content/60">{signalRows} source{signalRows === 1 ? "" : "s"} · {agentName}</p>
          </div>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-3 text-[17px] text-base-content/70">Active <Toggle on={sourcing} onChange={onToggleSourcing} label={sourcing ? "Pause lead sourcing" : "Resume lead sourcing"} /></span>
            <button type="button" onClick={() => setEditing(true)}
              className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-[#1f1d1a] px-5 text-[16.5px] font-medium text-white shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)] hover:bg-[#33302b]">
              <RiAddLine size={20} /> Lead sources
            </button>
          </div>
        </div>
        {editing && (
          <LeadSourcesDrawer initialItem={openImport ? "saved_list" : undefined} agentId={agentId} agentName={agentName} ownListId={ownListId} rows={rows} icp={icp} hasLinkedIn={hasLinkedIn}
            autoEnrichEmails={autoEnrichEmails} onClose={() => setEditing(false)} onChanged={onChanged} />
        )}

        <div className="overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          <div className={`${COLS} px-8 py-5`}>
            <div>
              <div className="flex items-center gap-3 text-[19px] font-medium text-base-content">Signals <span className="rounded-[6px] bg-base-200 px-2 py-0.5 text-[15.5px] font-normal text-base-content/70">{activeRows} of {signalRows} signals</span></div>
              <p className="mt-0.5 text-[16px] text-base-content/55">How Kairo continuously finds leads for this agent.</p>
            </div>
            <span />
            <span className="caps text-right text-[15px] text-base-content/50">Leads</span>
            <span className="caps text-right text-[15px] text-base-content/50">Next run</span>
            <span />
          </div>

          {!listed.length && <p className="border-t border-[var(--border-subtle)] px-8 py-10 text-center text-[16px] text-base-content/50">No signals yet. Click Lead sources to start finding people.</p>}

          {grouped.map((s) => {
            const items = s.items ?? [];
            const [one, many] = UNIT[s.source_type] ?? ["item", "items"];
            return groupRow(s.id, GROUP_TITLE[s.source_type], `${items.length} ${items.length === 1 ? one : many} tracked`, s.leads, <NextCell s={s} units={s.schedule ?? []} />, !!s.enabled, () => void toggle(s),
              LOOK[s.source_type] ?? LOOK.events,
              items.length ? items.map((it) => childRow(s, it, it.label, it.sub, it.leads)) : childRow(s, null, GROUP_TITLE[s.source_type], "Nothing tracked yet", s.leads),
              s.last_error);
          })}

          {events.length > 0 && (() => {
            const on = events.some((e) => e.enabled);
            const live = events.filter((e) => e.enabled);
            return groupRow("events", "Buying events", `${events.length} event${events.length === 1 ? "" : "s"} tracked`, events.reduce((n, e) => n + e.leads, 0),
              <NextCell s={live[0] ?? events[0]} units={live.flatMap((e) => e.schedule ?? [])} />, on, () => void toggleEvents(), LOOK.events,
              events.map((e) => childRow(e, null, EVENT_TITLE[e.source_type] ?? SIGNAL_LABEL[e.source_type] ?? e.source_type, e.last_error ?? null, e.leads, EVENT_ICON[e.source_type] ?? <RiRadarLine size={18} />)));
          })()}

          <div className="flex items-start gap-5 border-t border-[var(--border-subtle)] px-8 py-6">
            <Toggle on={!!lookalike?.enabled} onChange={() => void toggleLookalike()} label="Find more matching leads" />
            <div>
              <div className="flex items-center gap-2 text-[18.5px] text-base-content">Find more matching leads <RiGroupLine size={18} className="text-base-content/40" /></div>
              <p className="text-[16px] text-base-content/60">When your signals don&apos;t find enough leads, Kairo automatically adds prospects that closely match your target.
                {lookalike?.enabled ? <> · {lookalike.leads} found · {nextLabel(lookalike)}</> : null}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The source's stored config without one tracked item (mirrors lib/agents/source-items configWithItems). */
function withoutItem(s: AgentSourceRow, key: string): Record<string, unknown> {
  let c: Record<string, unknown> = {};
  try { c = JSON.parse(s.config_json || "{}") as Record<string, unknown>; } catch { /* empty config */ }
  const list = (k: string) => (Array.isArray(c[k]) ? c[k] as unknown[] : null);
  if (list("keywords")?.length) return { ...c, keywords: list("keywords")!.filter((x) => x !== key) };
  if (list("urls")?.length) return { ...c, urls: list("urls")!.filter((x) => x !== key) };
  if (list("boards")?.length) return { ...c, boards: (list("boards") as Array<{ ats: string; slug: string }>).filter((b) => `${b.ats}:${b.slug}` !== key) };
  if (list("list_ids")?.length) return { ...c, list_ids: list("list_ids")!.filter((x) => x !== key) };
  return c;
}
