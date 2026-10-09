import { useState, type ReactNode } from "react";
import {
  RiArrowRightLine, RiCalendarCheckLine, RiErrorWarningLine, RiFocus3Line, RiLineChartLine, RiLinkedinBoxFill, RiMailLine, RiMailSendLine,
  RiPauseCircleLine, RiPlayCircleLine, RiRadarLine, RiSearchEyeLine, RiSettings3Line, RiSparkling2Line, RiUserAddLine, RiUserFollowLine,
  RiUserSearchLine, RiInformationLine, RiFireLine,
} from "react-icons/ri";
import TrendChart from "@/components/ui/TrendChart";
import { Avatar, IconTile, Panel, SectionHeading, Segmented, StatTile, timeAgo, type Tone } from "@/components/agents/ui";

export interface FunnelRow { signal_type: string; label: string; detected: number; qualified: number; contacted: number; accepted: number; replied: number; positive: number; meetings: number }
export interface DetectorRun { id: string; source_type: string; started_at: string; candidates: number; ingested: number; filtered: number; linkedin_requests: number; error: string | null }
export interface Budget { paused: { until: string; reason: string } | null; usage: Record<string, { used: number; limit: number }> }
export interface Performance { found: number; contacted: number; accepted: number; replied: number; interested: number }
export interface DayPoint { day: string; found: number; invitations: number; messages: number; emails: number }
export interface ActivityItem { id: string; kind: "discovery" | "campaign" | "setup"; title: string; detail: string | null; at: string }

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

const SERIES = [
  { key: "found" as const, label: "Leads found", color: "#5db8a6" },
  { key: "invitations" as const, label: "Invitations sent", color: "#cc785c" },
  { key: "messages" as const, label: "Messages sent", color: "#e8a55a" },
  { key: "emails" as const, label: "Emails sent", color: "#6c6a64" },
];

/** Overview: what happens next, lifetime performance, a short chart, and the latest activity. */
export default function AgentOverview({ performance, series, activity, dueToday, budget, onReview, onActivity }: {
  performance: Performance; series: DayPoint[]; activity: ActivityItem[]; dueToday: number; budget: Budget | null;
  onReview: () => void; onActivity: () => void;
}) {
  const p = performance;
  const [range, setRange] = useState<"7 days" | "30 days">("7 days");
  const days = series.slice(-(range === "7 days" ? 7 : 30));
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-8">
        <section className="space-y-3">
          <SectionHeading title="Actions" />
          {budget?.paused && (
            <ActionRow icon={<RiPauseCircleLine size={20} />} tone="amber" title="LinkedIn discovery is paused" subtitle={budget.paused.reason} />
          )}
          <ActionRow icon={<RiPlayCircleLine size={20} />} tone="coral"
            title={`${dueToday} lead${dueToday === 1 ? "" : "s"} will be contacted today`} subtitle="Steps already due on this campaign."
            action={<button type="button" className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:text-[var(--primary-hover)]" onClick={onReview}>Review leads <RiArrowRightLine size={15} /></button>} />
        </section>

        <section className="space-y-4">
          <SectionHeading title="Performance" subtitle="From leads found to interested replies" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Found" value={p.found} icon={<RiUserSearchLine size={18} />} tone="teal" />
            <StatTile label="Contacted" value={p.contacted} hint={p.found ? `${pct(p.contacted, p.found)} of found` : undefined} icon={<RiMailSendLine size={18} />} tone="coral" />
            <StatTile label="Accepted" value={p.accepted} hint={p.contacted ? `${pct(p.accepted, p.contacted)} acceptance rate` : undefined} icon={<RiUserFollowLine size={18} />} tone="linkedin" />
            <StatTile label="Replied" value={p.replied || "—"} hint={p.contacted && p.replied ? `${pct(p.replied, p.contacted)} reply rate` : undefined} icon={<RiMailLine size={18} />} tone="amber" />
            <StatTile label="Interested" value={p.interested || "—"} icon={<RiFireLine size={18} />} tone="success" />
          </div>
        </section>

        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconTile icon={<RiLineChartLine size={18} />} tone="coral" size={36} />
              <div className="text-[20px] font-semibold leading-none">Last {Math.min(days.length, range === "7 days" ? 7 : 30)} days</div>
              <Segmented options={["7 days", "30 days"] as const} value={range} onChange={setRange} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px] text-base-content/60">
              {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
            </div>
          </div>
          <Chart days={days} />
        </Panel>
      </div>

      <Panel className="flex max-h-[760px] flex-col xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="text-[20px] font-semibold leading-none">Activity feed</h2>
          <button type="button" className="inline-flex items-center gap-1 text-[14.5px] font-medium text-primary" onClick={onActivity}>View all <RiArrowRightLine size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {activity.length === 0 && <p className="px-3 py-8 text-center text-[15px] text-base-content/45">Nothing yet. Sources and sends show up here.</p>}
          {activity.slice(0, 14).map((item) => {
            const m = describe(item);
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-[8px] px-3 py-2.5 hover:bg-base-200/60">
                {m.avatar ? <Avatar name={item.title} size={32} /> : <IconTile icon={m.icon} tone={m.tone} size={32} />}
                <div className="min-w-0 flex-1 text-[15px]">
                  <div className="truncate"><span className="font-medium text-base-content">{m.event}</span>{m.who && <span className="text-base-content/50"> · {m.who}</span>}</div>
                  {m.sub && <div className="truncate text-[13.5px] text-base-content/45">{m.sub}</div>}
                </div>
                <span className="shrink-0 text-[12.5px] text-base-content/40">{timeAgo(item.at)}</span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function ActionRow({ icon, tone, title, subtitle, action }: { icon: ReactNode; tone: Tone; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <Panel className="flex flex-wrap items-center gap-4 px-5 py-4">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-base-content">{title}</div>
        {subtitle && <div className="text-[15px] text-base-content/55">{subtitle}</div>}
      </div>
      {action}
    </Panel>
  );
}

/** Daily leads found and sends (Recharts), with the shared dated tooltip. */
function Chart({ days }: { days: DayPoint[] }) {
  if (!days.length) return <p className="py-14 text-center text-[15px] text-base-content/45">No activity in this period yet.</p>;
  return <div className="mt-4"><TrendChart data={days} series={SERIES} height={240} compact /></div>;
}

interface Described { event: string; who?: string; sub?: string; avatar: boolean; icon: ReactNode; tone: Tone; label: string; labelIcon: ReactNode; labelTone: "ok" | "muted" | "error" | "plain" }

/** Turns a raw activity item (source run, new lead, campaign log) into a display row. */
function describe(item: ActivityItem): Described {
  if (item.id.startsWith("lead:")) {
    return { event: "New lead found", who: item.title, sub: item.detail ?? undefined, avatar: true, icon: null, tone: "teal", label: "Lead found", labelIcon: <RiUserSearchLine size={15} />, labelTone: "plain" };
  }
  if (item.id.startsWith("run:")) {
    const failed = !!item.detail && !/^\d+ new, \d+ filtered$/.test(item.detail);
    const n = Number(item.detail?.match(/^(\d+) new/)?.[1] ?? 0);
    return {
      event: failed ? `${item.title} failed` : `${n} new lead${n === 1 ? "" : "s"} found`, who: failed ? undefined : item.title, sub: item.detail ?? undefined,
      avatar: false, icon: failed ? <RiErrorWarningLine size={16} /> : <RiRadarLine size={16} />, tone: failed ? "error" : "teal",
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
