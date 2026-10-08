import { Card, timeAgo } from "@/components/agents/ui";

export interface FunnelRow { signal_type: string; label: string; detected: number; qualified: number; contacted: number; accepted: number; replied: number; positive: number; meetings: number }
export interface DetectorRun { id: string; source_type: string; started_at: string; candidates: number; ingested: number; filtered: number; linkedin_requests: number; error: string | null }
export interface Budget { paused: { until: string; reason: string } | null; usage: Record<string, { used: number; limit: number }> }
export interface Performance { found: number; contacted: number; accepted: number; replied: number; interested: number }
export interface DayPoint { day: string; found: number; invitations: number; messages: number; emails: number }
export interface ActivityItem { id: string; kind: "discovery" | "campaign" | "setup"; title: string; detail: string | null; at: string }

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

/** Overview: what happens next, lifetime performance, a short chart, and the latest activity. */
export default function AgentOverview({ performance, series, activity, dueToday, budget, onReview, onActivity }: {
  performance: Performance; series: DayPoint[]; activity: ActivityItem[]; dueToday: number; budget: Budget | null;
  onReview: () => void; onActivity: () => void;
}) {
  const p = performance;
  const max = Math.max(1, ...series.map((d) => d.found + d.invitations + d.messages + d.emails));
  const bars = [
    { key: "found" as const, label: "Leads found", className: "bg-primary" },
    { key: "invitations" as const, label: "Invitations", className: "bg-info" },
    { key: "messages" as const, label: "Messages", className: "bg-success" },
    { key: "emails" as const, label: "Emails", className: "bg-warning" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Actions</h2>
          <div className="space-y-2">
            {budget?.paused && (
              <Card className="flex items-center justify-between gap-3 !py-3">
                <div><div className="font-medium">LinkedIn discovery is paused</div><div className="text-sm text-base-content/55">{budget.paused.reason}</div></div>
              </Card>
            )}
            <Card className="flex items-center justify-between gap-3 !py-3">
              <div><div className="font-medium">{dueToday} lead{dueToday === 1 ? "" : "s"} will be contacted today</div><div className="text-sm text-base-content/55">Steps already due on this campaign.</div></div>
              <button className="text-sm font-medium text-primary" onClick={onReview}>Review leads</button>
            </Card>
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Performance</h2>
          <p className="mb-2 text-xs text-base-content/45">From leads found to interested replies</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Found" value={String(p.found)} />
            <Stat label="Contacted" value={String(p.contacted)} hint={pct(p.contacted, p.found)} />
            <Stat label="Accepted" value={String(p.accepted)} hint={`${pct(p.accepted, p.contacted)} acceptance`} />
            <Stat label="Replied" value={p.replied ? String(p.replied) : "—"} hint={p.contacted ? pct(p.replied, p.contacted) : undefined} />
            <Stat label="Interested" value={p.interested ? String(p.interested) : "—"} />
          </div>
        </div>
        <Card>
          <div className="mb-3 text-sm font-semibold">Last {series.length} days</div>
          <div className="flex h-28 items-end gap-1">
            {series.map((d) => {
              const total = d.found + d.invitations + d.messages + d.emails;
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.found} leads found, ${d.invitations} invitations, ${d.messages} messages, ${d.emails} emails`}>
                  <div className="flex w-full flex-col-reverse justify-start" style={{ height: 96 }}>
                    {total === 0
                      ? <div className="h-px w-full bg-base-300" />
                      : bars.map((bar) => d[bar.key] > 0 ? <div key={bar.key} className={`w-full ${bar.className}`} style={{ height: `${(d[bar.key] / max) * 96}px` }} /> : null)}
                  </div>
                  <span className="text-[10px] text-base-content/40">{d.day.slice(5)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-base-content/55">
            {bars.map((bar) => (
              <span key={bar.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${bar.className}`} />{bar.label}</span>
            ))}
          </div>
        </Card>
      </div>
      <Card className="!p-0">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-sm font-semibold">Activity feed</h2>
          <button className="text-xs font-medium text-primary" onClick={onActivity}>View all</button>
        </div>
        <div className="max-h-[520px] divide-y divide-[var(--border-subtle)] overflow-y-auto">
          {activity.length === 0 && <p className="px-4 py-6 text-sm text-base-content/45">Nothing yet. Sources and sends show up here.</p>}
          {activity.slice(0, 12).map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate text-sm font-medium">{item.title}</div>{item.detail && <div className="truncate text-xs text-base-content/50">{item.detail}</div>}</div>
                <span className="shrink-0 text-[11px] text-base-content/40">{timeAgo(item.at)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="!p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-base-content/40">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-base-content/45">{hint}</div>}
    </Card>
  );
}

export function ActivityList({ items, filter }: { items: ActivityItem[]; filter: "all" | "discovery" | "campaign" | "setup" }) {
  const rows = filter === "all" ? items : items.filter((i) => i.kind === filter);
  if (!rows.length) return <p className="text-sm text-base-content/45">No {filter === "all" ? "activity" : filter} yet.</p>;
  return (
    <Card className="!p-0">
      <div className="divide-y divide-[var(--border-subtle)]">
        {rows.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-base-content/50">{item.kind}{item.detail ? ` · ${item.detail}` : ""}</div>
            </div>
            <span className="shrink-0 text-xs text-base-content/40">{timeAgo(item.at)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
