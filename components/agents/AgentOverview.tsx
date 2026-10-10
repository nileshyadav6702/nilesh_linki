import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { DateRangeCalendar } from "@/components/ui/DateRangePicker";
import { Tip } from "@/components/agents/campaign/kit";
import {
  RiArrowRightLine, RiCalendarCheckLine, RiErrorWarningLine, RiFocus3Line, RiLineChartLine, RiLinkedinBoxFill, RiMailLine, RiMailSendLine,
  RiPauseCircleLine, RiRadarLine, RiSearchEyeLine, RiSettings3Line, RiSparkling2Line, RiUserAddLine, RiUserFollowLine,
  RiUserSearchLine, RiInformationLine, RiFireLine, RiCalendarLine, RiChat1Line, RiCloseLine, RiCopperCoinLine,
} from "react-icons/ri";
import TrendChart from "@/components/ui/TrendChart";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { Avatar, IconTile, Panel, timeAgo, type Tone } from "@/components/agents/ui";

export interface FunnelRow { signal_type: string; label: string; detected: number; qualified: number; contacted: number; accepted: number; replied: number; positive: number; meetings: number }
export interface DetectorRun { id: string; source_type: string; started_at: string; candidates: number; ingested: number; filtered: number; linkedin_requests: number; error: string | null }
export interface Budget { paused: { until: string; reason: string } | null; usage: Record<string, { used: number; limit: number }> }
export interface Performance { found: number; contacted: number; accepted: number; replied: number; interested: number }
export interface DayPoint { day: string; found: number; invitations: number; messages: number; emails: number }
export type ActivityEvent = "invite_sent" | "invite_accepted" | "message_sent" | "voice_sent" | "inmail_sent" | "email_sent" | "replied" | "problem";
export interface ActivityItem {
  id: string; kind: "discovery" | "campaign" | "setup"; title: string; detail: string | null; at: string;
  event?: ActivityEvent; person?: { id: string; name: string; avatar: string | null };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

const SERIES = [
  { key: "found" as const, label: "Leads found", color: "#1fb5a1" },
  { key: "invitations" as const, label: "Invitations sent", color: "#b57cf0" },
  { key: "messages" as const, label: "Messages sent", color: "#f0609e" },
  { key: "emails" as const, label: "Emails sent", color: "#5b8def" },
];

type Range = "7" | "30" | "custom";

/** Below this share of the monthly refill, the Overview warns that outreach may stop. */
const LOW_CREDITS_SHARE = 0.15;

/** A "leads contacted today" card, once dismissed, stays hidden for the rest of the day. */
const dismissKey = (agentId: string) => `kairo.overview.due.${agentId}.${new Date().toISOString().slice(0, 10)}`;
function readDismissed(agentId: string): boolean {
  try { return window.localStorage.getItem(dismissKey(agentId)) === "1"; } catch { return false; }
}

/** Overview: what needs attention, lifetime performance, a chart over a chosen period, and the latest activity. */
export default function AgentOverview({ agentId, performance, series, activity, dueToday, budget, credits, onReview, onActivity }: {
  agentId: string; performance: Performance; series: DayPoint[]; activity: ActivityItem[]; dueToday: number; budget: Budget | null;
  credits?: { balance: number; next_refill: number } | null; onReview: () => void; onActivity: () => void;
}) {
  const p = performance;
  const [range, setRange] = useState<Range>("7");
  const [custom, setCustom] = useState<{ from: string; to: string; points: DayPoint[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [dueHidden, setDueHidden] = useState(() => typeof window !== "undefined" && readDismissed(agentId));
  const [openLead, setOpenLead] = useState<string | null>(null);
  const feed = activity.slice(0, 30);
  const feedLeads = [...new Set(feed.flatMap((i) => (i.person ? [i.person.id] : [])))];
  const days = range === "custom" && custom ? custom.points : series.slice(-Number(range === "custom" ? 7 : range));
  const lowCredits = !!credits && credits.balance < Math.max(20, credits.next_refill * LOW_CREDITS_SHARE);
  const title = range === "custom" && custom ? `${format(parseISO(custom.from), "MMM d")} – ${format(parseISO(custom.to), "MMM d")}` : `Last ${range === "30" ? 30 : 7} days`;

  async function pickDates(r: { from: string; to: string }) {
    setPicking(false);
    const res = await fetch(`/api/agents/${agentId}/series?from=${r.from}&to=${r.to}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Could not load that period"); return; }
    setCustom({ ...r, points: d.series ?? [] });
    setRange("custom");
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_490px]">
      <div className="min-w-0 space-y-9">
        <section className="space-y-4">
          <h2 className="text-[22px] font-semibold text-base-content">Actions</h2>
          {lowCredits && (
            <ActionRow icon={<RiCopperCoinLine size={22} />} title="Your organization is running out of credits" subtitle="Add credits to keep your outreach running"
              action={<Link href="/settings?tab=billing" className="inline-flex items-center gap-1.5 text-[16.5px] text-[#f0785a] hover:underline">Add credits <RiArrowRightLine size={18} /></Link>} />
          )}
          {budget?.paused && <ActionRow icon={<RiPauseCircleLine size={22} />} title="LinkedIn discovery is paused" subtitle={budget.paused.reason} />}
          {dueToday > 0 && !dueHidden && (
            <ActionRow icon={<RiChat1Line size={22} />} title={`${dueToday} lead${dueToday === 1 ? "" : "s"} will be contacted today`} subtitle="Review their profiles and messages before they go out"
              action={<span className="flex items-center gap-5">
                <button type="button" className="inline-flex items-center gap-1.5 text-[16.5px] text-[#f0785a] hover:underline" onClick={onReview}>Review leads <RiArrowRightLine size={18} /></button>
                <button type="button" aria-label="Dismiss for today" className="text-base-content/40 hover:text-base-content"
                  onClick={() => { setDueHidden(true); try { window.localStorage.setItem(dismissKey(agentId), "1"); } catch { /* storage unavailable */ } }}><RiCloseLine size={24} /></button>
              </span>} />
          )}
          {!lowCredits && !budget?.paused && (dueToday === 0 || dueHidden) && <p className="text-[16px] text-base-content/50">Nothing needs your attention right now.</p>}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-[22px] font-semibold text-base-content">Performance</h2>
            <p className="text-[16px] text-base-content/60">From leads found to interested replies</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Found" value={p.found} corner={<Tip text="Every lead this agent's sources found, before ICP scoring."><RiInformationLine size={19} className="shrink-0 text-base-content/45" /></Tip>} />
            <Stat i={1} label="Contacted" value={p.contacted} hint={p.found && p.contacted ? `${pct(p.contacted, p.found)} of found` : undefined} />
            <Stat i={2} label="Accepted" value={p.accepted} hint={p.contacted ? `${pct(p.accepted, p.contacted)} acceptance rate` : undefined} />
            <Stat i={3} label="Replied" value={p.replied || "—"} hint={p.contacted && p.replied ? `${pct(p.replied, p.contacted)} reply rate` : undefined} />
            <Stat i={4} label="Interested" value={p.interested || "—"} corner={<RiFireLine size={22} className="shrink-0 text-[#f0785a]" />} />
          </div>
        </section>

        <section className="rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div className="flex items-center gap-3">
              <RiLineChartLine size={24} className="text-[#f0785a]" />
              <div className="text-[21px] font-medium leading-tight">{title}</div>
            </div>
            <div className="relative flex items-center gap-1 rounded-full bg-base-200 p-1 text-[15.5px]">
              {(["7", "30"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
                  className={`rounded-full px-4 py-1.5 transition-colors ${range === r ? "bg-base-100 font-medium shadow-sm" : "text-base-content/65 hover:text-base-content"}`}>{r} days</button>
              ))}
              <button type="button" onClick={() => setPicking(!picking)} aria-pressed={range === "custom"} aria-expanded={picking}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 transition-colors ${range === "custom" ? "bg-base-100 font-medium shadow-sm" : "text-base-content/65 hover:text-base-content"}`}>
                <RiCalendarLine size={17} /> Select dates
              </button>
              {picking && (
                <div className="pop-in absolute left-0 top-full z-30 mt-2 rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
                  <DateRangeCalendar value={custom ? { from: custom.from, to: custom.to } : null} onChange={(r) => void pickDates(r)} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[15.5px] text-base-content/70">
              {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
            </div>
          </div>
          <Chart days={days} />
        </section>
      </div>

      <section className="flex max-h-[820px] flex-col xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-[22px] font-semibold leading-none">Activity Feed</h2>
          <button type="button" className="inline-flex items-center gap-1.5 text-[16px] text-[#f0785a] hover:underline" onClick={onActivity}>View all <RiArrowRightLine size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {activity.length === 0 && <p className="px-3 py-8 text-center text-[15px] text-base-content/45">Nothing yet. Sources and sends show up here.</p>}
          {feed.map((item) => {
            const m = describe(item);
            const person = item.person;
            return (
              <div key={item.id} className="flex items-center gap-4 rounded-[10px] px-3 py-3 hover:bg-base-200/60">
                {person
                  ? <button type="button" aria-label={`Open ${person.name}`} onClick={() => setOpenLead(person.id)} className="shrink-0 rounded-full"><Avatar name={person.name} src={person.avatar} size={38} /></button>
                  : <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#f0785a]/12 text-[#f0785a]">{m.icon}</span>}
                <div className="min-w-0 flex-1 text-[16px]">
                  <div className="truncate"><span className="text-base-content">{m.event}</span>
                    {person
                      ? <> <span className="text-base-content/50">·</span> <button type="button" onClick={() => setOpenLead(person.id)} className="text-base-content/50 hover:text-base-content hover:underline">{person.name}</button></>
                      : m.who && <span className="text-base-content/50"> · {m.who}</span>}
                  </div>
                  {m.sub && <div className="truncate text-[15px] text-base-content/55">{m.sub}</div>}
                </div>
                <span className="shrink-0 text-[15px] text-base-content/45">{agoLong(item.at)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <LeadDrawer targetId={openLead} onClose={() => setOpenLead(null)} onChanged={() => {}} siblings={feedLeads} onOpen={setOpenLead} />
    </div>
  );
}

/** "2 hours ago", "3 days ago". */
function agoLong(iso: string): string {
  const t = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? "" : formatDistanceToNowStrict(t, { addSuffix: true });
}

function Stat({ label, value, hint, corner, i = 0 }: { label: string; value: ReactNode; hint?: string; corner?: ReactNode; i?: number }) {
  return (
    <div style={{ "--i": i } as React.CSSProperties} className="wizard-rise stagger min-h-[160px] rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-5 py-5">
      <div className="flex items-start justify-between gap-2"><span className="text-[17px] text-base-content/75">{label}</span>{corner}</div>
      <div className="mt-3 text-[34px] font-semibold leading-none tabular-nums text-base-content">{value}</div>
      {hint && <div className="mt-3 text-[15.5px] leading-snug text-base-content/55">{hint}</div>}
    </div>
  );
}

function ActionRow({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-6 py-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[#f0785a]/10 text-[#f0785a]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[18px] text-base-content">{title}</div>
        {subtitle && <div className="text-[16px] text-base-content/60">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

/** Daily leads found and sends (Recharts), with the shared dated tooltip. */
function Chart({ days }: { days: DayPoint[] }) {
  if (!days.length) return <p className="py-14 text-center text-[15px] text-base-content/45">No activity in this period yet.</p>;
  return <div className="mt-6"><TrendChart data={days} series={SERIES} height={280} compact /></div>;
}

interface Described { event: string; who?: string; sub?: string; avatar: boolean; icon: ReactNode; tone: Tone; label: string; labelIcon: ReactNode; labelTone: "ok" | "muted" | "error" | "plain" }

/** Turns a raw activity item (source run, new lead, campaign log) into a display row. */
const EVENT: Record<ActivityEvent, { event: string; icon: ReactNode; tone: Tone; labelTone: Described["labelTone"] }> = {
  invite_sent: { event: "Invitation sent", icon: <RiUserAddLine size={16} />, tone: "linkedin", labelTone: "plain" },
  invite_accepted: { event: "Invitation accepted", icon: <RiUserFollowLine size={16} />, tone: "success", labelTone: "ok" },
  message_sent: { event: "Message sent", icon: <RiLinkedinBoxFill size={16} />, tone: "linkedin", labelTone: "plain" },
  voice_sent: { event: "Voice message sent", icon: <RiLinkedinBoxFill size={16} />, tone: "linkedin", labelTone: "plain" },
  inmail_sent: { event: "InMail sent", icon: <RiLinkedinBoxFill size={16} />, tone: "linkedin", labelTone: "plain" },
  email_sent: { event: "Email sent", icon: <RiMailSendLine size={16} />, tone: "coral", labelTone: "plain" },
  replied: { event: "Replied", icon: <RiMailLine size={16} />, tone: "success", labelTone: "ok" },
  problem: { event: "Problem", icon: <RiErrorWarningLine size={16} />, tone: "error", labelTone: "error" },
};

function describe(item: ActivityItem): Described {
  if (item.event) {
    const e = EVENT[item.event];
    return item.event === "problem"
      ? { event: item.title, avatar: false, icon: e.icon, tone: e.tone, label: e.event, labelIcon: e.icon, labelTone: e.labelTone }
      : { event: e.event, who: item.person?.name ?? item.title, avatar: true, icon: e.icon, tone: e.tone, label: e.event, labelIcon: e.icon, labelTone: e.labelTone };
  }
  if (item.id.startsWith("lead:")) {
    return { event: "New lead found", who: item.title, sub: item.detail ?? undefined, avatar: true, icon: null, tone: "teal", label: "Lead found", labelIcon: <RiUserSearchLine size={15} />, labelTone: "plain" };
  }
  if (item.id.startsWith("run:")) {
    const failed = !!item.detail && !/^\d+ new, \d+ filtered$/.test(item.detail);
    const n = Number(item.detail?.match(/^(\d+) new/)?.[1] ?? 0);
    return {
      event: failed ? `${item.title} failed` : `${n} New lead${n === 1 ? "" : "s"} found`, sub: failed ? item.detail ?? undefined : item.title,
      avatar: false, icon: failed ? <RiErrorWarningLine size={16} /> : <RiFocus3Line size={17} />, tone: failed ? "error" : "teal",
      label: failed ? "Run failed" : `${n} new`, labelIcon: failed ? <RiErrorWarningLine size={15} /> : <RiSearchEyeLine size={15} />, labelTone: failed ? "error" : n > 0 ? "ok" : "muted",
    };
  }
  if (item.kind === "setup") return { event: item.title, sub: item.detail ?? undefined, avatar: false, icon: <RiSettings3Line size={16} />, tone: "ink", label: "Setup", labelIcon: <RiSettings3Line size={15} />, labelTone: "muted" };
  const t = item.title.toLowerCase();
  const pick = (icon: ReactNode, label: string, labelTone: Described["labelTone"], tone: Tone): Described =>
    ({ event: item.title, sub: item.detail ?? undefined, avatar: false, icon, tone, label, labelIcon: icon, labelTone });
  if (/accept/.test(t)) return pick(<RiUserFollowLine size={16} />, "Invitation accepted", "ok", "success");
  if (/invit|connect/.test(t)) return pick(<RiUserAddLine size={16} />, "Invitation sent", "plain", "linkedin");
  if (/repl/.test(t)) return pick(<RiMailLine size={16} />, "Replied", "ok", "success");
  if (/enrich/.test(t)) return pick(<RiSparkling2Line size={16} />, "Enriched", "plain", "amber");
  if (/email|mail/.test(t)) return pick(<RiMailSendLine size={16} />, "Email sent", "plain", "coral");
  if (/message|linkedin/.test(t)) return pick(<RiLinkedinBoxFill size={16} />, "Message sent", "plain", "linkedin");
  if (/meeting|call|demo/.test(t)) return pick(<RiCalendarCheckLine size={16} />, "Meeting", "ok", "success");
  if (/fail|error|could not/.test(t)) return pick(<RiErrorWarningLine size={16} />, "Problem", "error", "error");
  return pick(<RiInformationLine size={16} />, "Update", "muted", "ink");
}

const SOURCE_CHIP: Record<ActivityItem["kind"], { label: string; icon: ReactNode }> = {
  discovery: { label: "Lead discovery", icon: <RiFocus3Line size={12} /> },
  campaign: { label: "Campaign", icon: <RiMailSendLine size={12} /> },
  setup: { label: "Setup", icon: <RiSettings3Line size={12} /> },
};

const LABEL_TONE = { ok: "text-[#3a8c4f]", muted: "text-base-content/40", error: "text-error", plain: "text-base-content/70" };

function dayGroup(iso: string): string {
  const t = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (t >= start) return "Today";
  if (t.getTime() >= start.getTime() - 86_400_000) return "Yesterday";
  return "Earlier";
}

export function ActivityList({ items, filter }: { items: ActivityItem[]; filter: "all" | "discovery" | "campaign" | "setup" }) {
  const rows = filter === "all" ? items : items.filter((i) => i.kind === filter);
  if (!rows.length) {
    return (
      <Panel className="px-6 py-14 text-center">
        <IconTile icon={<RiRadarLine size={20} />} tone="ink" className="mx-auto" />
        <p className="mt-3 text-[15px] text-base-content/50">No {filter === "all" ? "activity" : filter} yet.</p>
      </Panel>
    );
  }
  const groups: Array<{ name: string; items: ActivityItem[] }> = [];
  for (const r of rows) {
    const g = dayGroup(r.at);
    if (groups[groups.length - 1]?.name !== g) groups.push({ name: g, items: [] });
    groups[groups.length - 1].items.push(r);
  }
  return (
    <Panel className="overflow-hidden">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="border-b border-[var(--border-subtle)] bg-base-200/70 px-5 py-2 text-[13.5px] font-medium uppercase tracking-[1.2px] text-base-content/50">{g.name}</div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {g.items.map((item) => {
              const m = describe(item);
              const chip = SOURCE_CHIP[item.kind];
              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                  {m.avatar ? <Avatar name={item.title} size={36} /> : <IconTile icon={m.icon} tone={m.tone} size={36} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-base-content">{m.avatar ? item.title : m.event}</div>
                    {(m.avatar ? item.detail : m.sub) && <div className="truncate text-[13.5px] text-base-content/50">{m.avatar ? item.detail : m.sub}</div>}
                    <div className="mt-1 flex items-center gap-2 text-[12.5px] text-base-content/45">
                      <span className="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 font-medium text-base-content/60">{chip.icon}{chip.label}</span>
                      <span>{timeAgo(item.at)}</span>
                    </div>
                  </div>
                  <span className={`hidden shrink-0 items-center gap-1.5 text-[14.5px] font-medium sm:inline-flex ${LABEL_TONE[m.labelTone]}`}>{m.labelIcon}{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Panel>
  );
}
